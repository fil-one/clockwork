import type { ProjectionRecord } from "@/src/features/experience-server/model";
import { formatDate, formatMoney } from "@/src/features/shared/format";
import type { MessageId, Translator } from "@/src/i18n";

import type { SurfaceFormatting } from "../formatting";
import {
  collectionContextFields,
  collectionContextStates,
  collectionCurrencies,
  collectionMemberRoles,
  collectionStatusDetails,
  collectionUpdateKinds,
  type CollectionContextField,
  type CollectionContextState,
  type CollectionContextValue,
  type CollectionMemberRole,
  type CollectionStatusDetail,
  type CollectionUpdateKind,
  type CollectionValueFact,
  type CustomerCollectionRecord,
  type CustomerCollectionRow,
} from "./collection-state";

/*
 * Customer collection records, from the projection payload to the row a reader
 * sees.
 *
 * Two shapes reach this module. A production projection writes its own text
 * (`statusLabel: "Pending"`, `context: [{ label, value }]`), which is shown as
 * written. The demo fixtures in `customer-data.ts` write facts instead -- a
 * status from a closed set, an amount in minor units, a calendar date -- so the
 * page can state them in the reader's language with the reader's digits. The
 * two never share a field value, so neither can be mistaken for the other.
 */

type Data = Readonly<Record<string, unknown>>;

function text(data: Data, key: string): string {
  const value = data[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Projection record omitted ${key}`);
  return value;
}

function number(data: Data, key: string): number {
  const value = data[key];
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`Projection record omitted ${key}`);
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  const match = allowed.find((candidate) => candidate === value);
  if (!match) throw new Error(`Projection field ${field} is invalid`);
  return match;
}

function isObject(value: unknown): value is Data {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown, field: string): Data {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Projection field ${field} is invalid`);
  return value as Data;
}

function minorUnits(data: Data, field: string): string {
  const value = data.amountMinor;
  if (typeof value !== "string" || !/^-?\d+$/u.test(value))
    throw new Error(`Projection field ${field} is invalid`);
  return value;
}

function calendarDate(data: Data, key: string, field: string): string {
  const value = data[key];
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    throw new Error(`Projection field ${field} is invalid`);
  return value;
}

function valueFact(raw: unknown): CollectionValueFact {
  const fact = object(raw, "value");
  const kind = fact.kind;
  switch (kind) {
    case "perYear":
    case "increasePerYear":
    case "estimated":
      return {
        kind,
        currency: oneOf(fact.currency, collectionCurrencies, "value"),
        amountMinor: minorUnits(fact, "value"),
      };
    case "noSpendChange":
    case "noCommitment":
    case "resolved":
      return { kind };
    case "role":
      return {
        kind,
        role: oneOf(fact.role, collectionMemberRoles, "value"),
      };
    case "dueOn":
    case "expiresOn":
      return { kind, on: calendarDate(fact, "on", "value") };
    case "taxFormYear":
      return { kind, year: number(fact, "year") };
    case "priority":
      return {
        kind,
        priority: oneOf(fact.priority, ["normal", "high"] as const, "value"),
      };
    default:
      throw new Error("Projection field value is invalid");
  }
}

function contextValue(raw: unknown): CollectionContextValue {
  const fact = object(raw, "context");
  const kind = fact.kind;
  switch (kind) {
    case "text":
    case "literal":
      return { kind, text: text(fact, "text") };
    case "date":
      return { kind, on: calendarDate(fact, "on", "context") };
    case "money":
      return {
        kind,
        currency: oneOf(fact.currency, collectionCurrencies, "context"),
        amountMinor: minorUnits(fact, "context"),
      };
    case "activeServices":
      return { kind, count: number(fact, "count") };
    case "state":
      return {
        kind,
        state: oneOf(fact.state, collectionContextStates, "context"),
      };
    case "merchantOfRecord":
      return { kind, provider: text(fact, "provider") };
    default:
      throw new Error("Projection context is invalid");
  }
}

function contextEntries(data: Data): CustomerCollectionRecord["context"] {
  const raw = data.context;
  if (!Array.isArray(raw)) throw new Error("Projection record omitted context");
  return raw.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("Projection context is invalid");
    const entry = item as Data;
    if ("field" in entry)
      return {
        field: oneOf(entry.field, collectionContextFields, "context"),
        value: contextValue(entry.value),
      };
    return { label: text(entry, "label"), value: text(entry, "value") };
  });
}

/**
 * The loader's reading of one customer collection projection record.
 *
 * Production text is validated exactly as before. Facts are validated against
 * their closed sets, so a fixture with a status this page has no words for
 * fails the read instead of rendering a raw key.
 */
export function customerCollectionRecord(
  record: ProjectionRecord,
): CustomerCollectionRecord {
  const data = record.data;
  const statusLabel = isObject(data.statusLabel)
    ? {
        detail: oneOf(
          data.statusLabel.detail,
          collectionStatusDetails,
          "statusLabel",
        ),
      }
    : text(data, "statusLabel");
  const updatedLabel = isObject(data.updatedLabel)
    ? {
        update: oneOf(
          data.updatedLabel.update,
          collectionUpdateKinds,
          "updatedLabel",
        ),
      }
    : text(data, "updatedLabel");
  // A fact-shaped "updated" entry is about the record's own date. The
  // projection's source timestamp is when the demo served it, which would put
  // every fixture at the same instant and make the date sort meaningless.
  const updatedAt =
    typeof updatedLabel === "object" && typeof data.updatedAt === "string"
      ? data.updatedAt
      : record.sourceUpdatedAt;
  return {
    id: text(data, "id"),
    title: text(data, "title"),
    description: text(data, "description"),
    status: oneOf(
      data.status,
      ["active", "pending", "review", "complete", "blocked"] as const,
      "status",
    ),
    statusLabel,
    risk: oneOf(data.risk, ["low", "medium", "high"] as const, "risk"),
    owner: text(data, "owner"),
    value: isObject(data.value) ? valueFact(data.value) : text(data, "value"),
    valueSort: number(data, "valueSort"),
    updatedAt,
    updatedLabel,
    context: contextEntries(data),
    recordVersion: record.version,
    projectionId: record.id,
    aggregateId: record.aggregateId,
  };
}

/**
 * The role a users-collection record names, from its fact or, for production
 * text, from the words in it. `/account` counts owners and billing contacts
 * with this.
 */
export function collectionMemberRole(
  data: Data,
): CollectionMemberRole | undefined {
  const value = data.value;
  if (isObject(value))
    return value.kind === "role"
      ? collectionMemberRoles.find((role) => role === value.role)
      : undefined;
  if (typeof value !== "string") return undefined;
  if (/owner/iu.test(value)) return "owner";
  if (/billing/iu.test(value)) return "billing";
  return undefined;
}

/**
 * The two counts `/account` states about its people. "People with access"
 * counts active members only: a pending invitation and a member whose access
 * was removed are both rows in the users collection, and neither can act on
 * the account.
 */
export function collectionMemberCounts(
  records: readonly Pick<ProjectionRecord, "data">[],
): { withAccess: number; invitations: number } {
  const statuses = records.map((record) => record.data.status);
  return {
    withAccess: statuses.filter((status) => status === "active").length,
    invitations: statuses.filter((status) => status === "pending").length,
  };
}

export const collectionStatusLabels: Readonly<
  Record<CollectionStatusDetail, MessageId>
> = {
  inReview: "status.inReview",
  awaitingCustomer: "customer.collection.status.awaitingCustomer",
  effective: "customer.collection.status.effective",
  completed: "status.complete",
  closedNotAccepted: "customer.collection.status.closedNotAccepted",
  active: "status.active",
  invitationPending: "customer.collection.status.invitationPending",
  accessRemoved: "customer.collection.status.accessRemoved",
  verified: "customer.collection.status.verified",
  awaitingBankCheck: "customer.collection.status.awaitingBankCheck",
  current: "customer.collection.status.current",
  accepted: "status.accepted",
  buyerAcceptanceNeeded: "customer.collection.status.buyerAcceptanceNeeded",
  disbursementPending: "customer.collection.status.disbursementPending",
  expired: "status.expired",
  inProgress: "status.inProgress",
  resolved: "status.resolved",
};

const updateMessages: Readonly<Record<CollectionUpdateKind, MessageId>> = {
  updated: "customer.collection.updated.updated",
  lastActive: "customer.collection.updated.lastActive",
  invited: "customer.collection.updated.invited",
  removed: "customer.collection.updated.removed",
  verified: "customer.collection.updated.verified",
  accepted: "customer.collection.updated.accepted",
  expired: "customer.collection.updated.expired",
  providerSync: "customer.collection.updated.providerSync",
  providerUpdate: "customer.collection.updated.providerUpdate",
  resolved: "customer.collection.updated.resolved",
};

export const collectionRoleLabels: Readonly<
  Record<CollectionMemberRole, MessageId>
> = {
  owner: "role.owner",
  admin: "role.admin",
  billing: "role.billing",
  member: "role.member",
  formerMember: "customer.collection.role.formerMember",
};

const fieldLabels: Readonly<Record<CollectionContextField, MessageId>> = {
  service: "recordKind.service",
  services: "customer.collection.field.services",
  effective: "customer.collection.field.effective",
  needed: "customer.collection.field.needed",
  agreement: "recordKind.agreement",
  evidence: "customer.collection.field.evidence",
  reason: "customer.collection.field.reason",
  serviceStart: "customer.collection.field.serviceStart",
  access: "customer.collection.field.access",
  security: "customer.collection.field.security",
  approvalLimit: "customer.collection.field.approvalLimit",
  expires: "customer.collection.field.expires",
  invoiceDelivery: "customer.collection.field.invoiceDelivery",
  creditDelivery: "customer.collection.field.creditDelivery",
  system: "customer.collection.field.system",
  nextStep: "customer.collection.field.nextStep",
  jurisdiction: "customer.collection.field.jurisdiction",
  document: "customer.collection.field.document",
  order: "recordKind.order",
  entity: "customer.collection.field.entity",
  classification: "customer.collection.field.classification",
  marketplace: "customer.collection.field.marketplace",
  billing: "customer.collection.field.billing",
  commitment: "customer.collection.field.commitment",
  source: "customer.collection.field.source",
  invoice: "recordKind.invoice",
};

const contextStates: Readonly<Record<CollectionContextState, MessageId>> = {
  allWorkflows: "customer.collection.context.allWorkflows",
  viewCommercialRecords: "customer.collection.context.viewCommercialRecords",
  noCurrentAccess: "customer.collection.context.noCurrentAccess",
  mfaVerified: "customer.collection.context.mfaVerified",
  mfaNotEnrolled: "customer.collection.context.mfaNotEnrolled",
  removalRecorded: "customer.collection.context.removalRecorded",
  emailAndPortal: "customer.collection.context.emailAndPortal",
  email: "customer.collection.context.email",
  supportProvider: "customer.collection.context.supportProvider",
  none: "common.none",
};

function valueText(
  fact: CollectionValueFact,
  t: Translator,
  locale: string,
): string {
  switch (fact.kind) {
    case "perYear":
      return t("customer.collection.value.perYear", {
        amount: formatMoney(fact.amountMinor, fact.currency, locale),
      });
    case "increasePerYear":
      return t("customer.collection.value.increasePerYear", {
        amount: formatMoney(fact.amountMinor, fact.currency, locale),
      });
    case "estimated":
      return t("customer.collection.value.estimated", {
        amount: formatMoney(fact.amountMinor, fact.currency, locale),
      });
    case "noSpendChange":
      return t("customer.collection.value.noSpendChange");
    case "noCommitment":
      return t("customer.collection.value.noCommitment");
    case "resolved":
      return t("status.resolved");
    case "role":
      return t(collectionRoleLabels[fact.role]);
    case "dueOn":
      return t("common.dueOn", { date: formatDate(fact.on, locale) });
    case "expiresOn":
      return t("common.expiresOn", { date: formatDate(fact.on, locale) });
    case "taxFormYear":
      return t("customer.collection.value.taxFormYear", { year: fact.year });
    case "priority":
      return t(
        fact.priority === "high"
          ? "customer.collection.value.priorityHigh"
          : "customer.collection.value.priorityNormal",
      );
  }
}

function contextText(
  value: CollectionContextValue,
  t: Translator,
  locale: string,
): string {
  switch (value.kind) {
    case "text":
    case "literal":
      return value.text;
    case "date":
      return formatDate(value.on, locale);
    case "money":
      return formatMoney(value.amountMinor, value.currency, locale);
    case "activeServices":
      return t("customer.collection.context.activeServices", {
        count: value.count,
      });
    case "state":
      return t(contextStates[value.state]);
    case "merchantOfRecord":
      return t("customer.collection.context.merchantOfRecord", {
        provider: value.provider,
      });
  }
}

/** A record's own date, in the reader's zone; no time of day. */
function recordDate(value: string, formatting: SurfaceFormatting): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat(formatting.locale, {
    dateStyle: "medium",
    timeZone: formatting.timeZone,
  }).format(parsed);
}

/**
 * The row a reader sees: facts stated in their language, production text as
 * written. Search, filters and sorting run on this, so a Portuguese reader
 * searching for "Vence" finds the record whose value says it.
 */
export function presentCustomerRecord(
  record: CustomerCollectionRecord,
  t: Translator,
  formatting: SurfaceFormatting,
): CustomerCollectionRow {
  const locale = formatting.locale;
  return {
    ...record,
    statusLabel:
      typeof record.statusLabel === "string"
        ? record.statusLabel
        : t(collectionStatusLabels[record.statusLabel.detail]),
    value:
      typeof record.value === "string"
        ? record.value
        : valueText(record.value, t, locale),
    updatedLabel:
      typeof record.updatedLabel === "string"
        ? record.updatedLabel
        : t(updateMessages[record.updatedLabel.update], {
            date: recordDate(record.updatedAt, formatting),
          }),
    context: record.context.map((entry) =>
      "field" in entry
        ? {
            label: t(fieldLabels[entry.field]),
            value: contextText(entry.value, t, locale),
          }
        : entry,
    ),
  };
}
