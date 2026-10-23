import { z } from "zod";

import { accountDocumentKinds } from "./account-documents";
import { partnerModels, partnerStatuses } from "./partners";

/**
 * Bringing a HubSpot company or deal into Commerce (docs/operations/
 * hubspot-handoff.md). HubSpot stays authoritative for CRM activity and
 * pipeline; Commerce owns the partner record. Linking, viewing and importing
 * are separate: a link records identity, a view reads current CRM data through
 * the approved scope, and an import copies only what a person selected in a
 * reviewed plan.
 *
 * Everything here is pure so the review, the commit and the receipt derive
 * their wording from one plan.
 */

/** HubSpot record IDs are decimal strings; nothing else reaches a request. */
export const HubSpotIdSchema = z.string().regex(/^\d{1,20}$/, "hubspot_id");
export type HubSpotId = z.infer<typeof HubSpotIdSchema>;

export const hubspotObjectTypes = ["company", "deal", "contact"] as const;
export type HubSpotObjectType = (typeof hubspotObjectTypes)[number];

/**
 * Properties every connection reads, because the handoff and pipeline cannot
 * work without them. The administrator sees this list at activation; any
 * other property stays unreadable until approved.
 */
export const hubspotBaseProperties = {
  company: [
    "name",
    "domain",
    "website",
    "country",
    "hubspot_owner_id",
    "hs_lastmodifieddate",
  ],
  deal: [
    "dealname",
    "amount",
    "deal_currency_code",
    "closedate",
    "pipeline",
    "dealstage",
    "hubspot_owner_id",
    "hs_lastmodifieddate",
  ],
  contact: ["firstname", "lastname", "email", "jobtitle", "lastmodifieddate"],
} as const satisfies Record<HubSpotObjectType, readonly string[]>;

/** Upper bounds that keep every read and import bounded. */
export const hubspotLimits = {
  searchResults: 25,
  associations: 100,
  contactsPerHandoff: 20,
  notesPerHandoff: 20,
  documentsPerHandoff: 10,
  referencePropertiesPerHandoff: 50,
  approvedPropertiesPerObject: 100,
  noteBodyCharacters: 4000,
  /** Deals read to build pipeline totals; beyond this coverage is partial. */
  pipelineDeals: 2000,
  pipelinePageSize: 50,
  /** The existing attachment limit (`contractDocumentMaxBytes`). */
  documentBytes: 25 * 1024 * 1024,
} as const;

/** Display freshness for live CRM reads, not an import schedule. */
export const hubspotFreshness = {
  targetMs: 5 * 60_000,
  staleMs: 15 * 60_000,
} as const;

// ---------------------------------------------------------------------------
// The live source, as the read adapter normalizes it.
// ---------------------------------------------------------------------------

export interface HubSpotPortal {
  portalId: string;
  /** Host of the HubSpot app for this portal, such as `app-eu1.hubspot.com`. */
  uiDomain: string;
  timeZone: string | null;
  companyCurrency: string | null;
}

export interface HubSpotPropertyDefinition {
  objectType: HubSpotObjectType;
  name: string;
  label: string;
  type: string;
  fieldType: string;
  options: readonly { label: string; value: string }[];
  /** HubSpot marks it sensitive or highly sensitive. Excluded by default. */
  sensitive: boolean;
  /** Defined by HubSpot rather than by the portal. */
  hubspotDefined: boolean;
  calculated: boolean;
}

export interface HubSpotOwner {
  id: string;
  name: string;
  email: string | null;
  archived: boolean;
}

/** An association with its labels resolved to names, never type IDs. */
export interface HubSpotAssociation {
  id: string;
  labels: readonly string[];
}

export interface HubSpotCompany {
  id: string;
  name: string | null;
  domain: string | null;
  website: string | null;
  country: string | null;
  ownerId: string | null;
  updatedAt: string | null;
  archived: boolean;
  /** Approved additional properties only; `null` is empty in HubSpot. */
  properties: Readonly<Record<string, string | null>>;
}

export interface HubSpotDeal {
  id: string;
  name: string | null;
  pipelineId: string | null;
  stageId: string | null;
  /** The amount exactly as HubSpot stores it; `null` is not set, never 0. */
  amount: string | null;
  currency: string | null;
  /** HubSpot stores close dates as instants. */
  closeDate: string | null;
  ownerId: string | null;
  updatedAt: string | null;
  archived: boolean;
  properties: Readonly<Record<string, string | null>>;
}

export interface HubSpotContact {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  jobTitle: string | null;
  updatedAt: string | null;
}

export interface HubSpotNote {
  id: string;
  /** Plain text: markup removed, line breaks kept, bounded. */
  body: string;
  ownerId: string | null;
  timestamp: string | null;
  attachmentIds: readonly string[];
}

export type HubSpotFileAvailability =
  "available" | "unsupported_type" | "too_large" | "unreadable";

export interface HubSpotFile {
  id: string;
  name: string;
  extension: string | null;
  size: number | null;
  updatedAt: string | null;
  availability: HubSpotFileAvailability;
  /** The note it came from, so the review can say where it was attached. */
  noteId: string;
}

export interface HubSpotPipelineStage {
  id: string;
  label: string;
  displayOrder: number;
  closed: boolean;
}

export interface HubSpotPipeline {
  id: string;
  label: string;
  displayOrder: number;
  stages: readonly HubSpotPipelineStage[];
}

/** One search result for the picker. */
export interface HubSpotSearchResult {
  objectType: "company" | "deal";
  id: string;
  name: string;
  /** A company's domain, or a deal's stage label. */
  detail: string | null;
  ownerName: string | null;
  updatedAt: string | null;
}

// ---------------------------------------------------------------------------
// Record URLs. A URL is a hint that names a record, never authority to read it.
// ---------------------------------------------------------------------------

const hubspotHost = /^app(?:-[a-z0-9]{2,10})?\.hubspot\.com$/;
const recordPath =
  /^\/contacts\/(\d{1,20})\/(?:(company|deal)|record\/(0-2|0-3))\/(\d{1,20})(?:\/|$)/;

export interface HubSpotRecordReference {
  portalId: string;
  objectType: "company" | "deal";
  objectId: string;
}

/** The record a pasted HubSpot URL names, or `null` when it names none. */
export function parseHubSpotRecordUrl(
  raw: string,
): HubSpotRecordReference | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !hubspotHost.test(url.hostname)) return null;
  const match = recordPath.exec(url.pathname);
  if (!match) return null;
  const [, portalId, named, typeId, objectId] = match;
  if (!portalId || !objectId) return null;
  const objectType =
    named === "company" || typeId === "0-2" ? "company" : "deal";
  return { portalId, objectType, objectId };
}

/** The HubSpot page for a record, on the portal's own app host. */
export function hubspotRecordUrl(
  portal: Pick<HubSpotPortal, "portalId" | "uiDomain">,
  objectType: HubSpotObjectType,
  objectId: string,
): string {
  const host = hubspotHost.test(portal.uiDomain)
    ? portal.uiDomain
    : "app.hubspot.com";
  const typeId =
    objectType === "company" ? "0-2" : objectType === "deal" ? "0-3" : "0-1";
  return `https://${host}/contacts/${encodeURIComponent(portal.portalId)}/record/${typeId}/${encodeURIComponent(objectId)}`;
}

// ---------------------------------------------------------------------------
// Bounded transformations: trimming and validated URL normalization only.
// ---------------------------------------------------------------------------

/** Trimmed, control characters removed, or `""` for empty. */
export function cleanHubSpotText(value: string | null, max: number): string {
  if (value === null) return "";
  const clean = [...value]
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? clean.slice(0, max).trimEnd() : clean;
}

/**
 * A website Commerce can store: the HubSpot website, or the domain as an
 * https URL. Anything that does not parse as an http(s) URL with a dotted
 * host is no proposal at all.
 */
export function normalizeHubSpotWebsite(
  website: string | null,
  domain: string | null,
): string {
  for (const candidate of [website, domain]) {
    const text = cleanHubSpotText(candidate, 500);
    if (!text) continue;
    const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    try {
      const url = new URL(withScheme);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      if (!url.hostname.includes(".") || url.username || url.password) continue;
      const normalized = url.toString();
      // A bare host keeps no trailing slash: "https://northstar.example".
      const result =
        url.pathname === "/" && !url.search && !url.hash
          ? normalized.replace(/\/$/, "")
          : normalized;
      if (result.length <= 500) return result;
    } catch {
      continue;
    }
  }
  return "";
}

export function hubspotContactName(contact: HubSpotContact): string {
  const name = cleanHubSpotText(
    [contact.firstName, contact.lastName].filter(Boolean).join(" "),
    200,
  );
  return name || cleanHubSpotText(contact.email, 200);
}

/** An email Commerce accepts, lower-cased, or `""`. */
export function hubspotContactEmail(contact: HubSpotContact): string {
  const email = cleanHubSpotText(contact.email, 320).toLowerCase();
  return z.email().safeParse(email).success ? email : "";
}

// ---------------------------------------------------------------------------
// The administrator's connection: one portal, an approved audience and scope.
// ---------------------------------------------------------------------------

export const hubspotConnectionStatuses = ["active", "disconnected"] as const;
export type HubSpotConnectionStatus =
  (typeof hubspotConnectionStatuses)[number];

export interface HubSpotScope {
  /** Approved additional properties per object, beyond the base set. */
  company: readonly string[];
  deal: readonly string[];
  contact: readonly string[];
  /** Deal pipelines staff may see; deals in any other pipeline stay unread. */
  pipelines: readonly string[];
  notes: boolean;
  files: boolean;
}

export interface HubSpotOwnerMapping {
  hubspotOwnerId: string;
  staffId: string;
  staffName: string;
}

export interface HubSpotConnectionRecord {
  id: string;
  portalId: string;
  uiDomain: string;
  status: HubSpotConnectionStatus;
  audience: string;
  approvedById: string;
  approvedByName: string;
  approvedAt: string;
  scope: HubSpotScope;
  defaultPipelineId: string | null;
  ownerMappings: readonly HubSpotOwnerMapping[];
  updatedAt: string;
  version: number;
}

/** The audience every connection names: who may read approved CRM data. */
export const hubspotAudience = "staff_sales_read" as const;

const propertyName = z.string().regex(/^[a-z0-9_]{1,100}$/, "hubspot_property");
const propertyList = z
  .array(propertyName)
  .max(hubspotLimits.approvedPropertiesPerObject)
  .default([])
  .transform((names) => [...new Set(names)].sort());

/**
 * Activation, or a change to an active connection. Activating requires the
 * administrator to accept that the approved audience may differ from each
 * person's HubSpot visibility; the shared connection does not reproduce
 * HubSpot user permissions.
 */
export const HubSpotConnectionInputSchema = z
  .object({
    expectedVersion: z.int().min(1).optional(),
    portalId: z.string().regex(/^\d{1,20}$/),
    audienceAccepted: z.literal(true),
    scope: z
      .object({
        company: propertyList,
        deal: propertyList,
        contact: propertyList,
        pipelines: z
          .array(z.string().regex(/^[A-Za-z0-9_-]{1,100}$/))
          .max(50)
          .default([])
          .transform((ids) => [...new Set(ids)]),
        notes: z.boolean().default(false),
        files: z.boolean().default(false),
      })
      .strict(),
    defaultPipelineId: z
      .union([
        z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
        z.literal(""),
        z.null(),
      ])
      .transform((value) => value || null)
      .default(null),
    ownerMappings: z
      .array(
        z
          .object({ hubspotOwnerId: HubSpotIdSchema, staffId: z.guid() })
          .strict(),
      )
      .max(500)
      .default([])
      .refine(
        (rows) =>
          new Set(rows.map((row) => row.hubspotOwnerId)).size === rows.length,
        "duplicate_owner",
      ),
  })
  .strict();
export type HubSpotConnectionInput = z.infer<
  typeof HubSpotConnectionInputSchema
>;

/** Whether a property may be read: base, or approved and not sensitive. */
export function hubspotPropertyAllowed(
  scope: HubSpotScope,
  objectType: HubSpotObjectType,
  name: string,
): boolean {
  return (
    (hubspotBaseProperties[objectType] as readonly string[]).includes(name) ||
    scope[objectType].includes(name)
  );
}

// ---------------------------------------------------------------------------
// The handoff: what a person reviewed and chose.
// ---------------------------------------------------------------------------

/** Partner fields a handoff may set. Commission, margin, exclusivity, terms,
 * contract and approval state are never imported, even with More control. */
export const hubspotPartnerFields = ["name", "website", "region"] as const;
export type HubSpotPartnerField = (typeof hubspotPartnerFields)[number];

/** Where each partner field's HubSpot value comes from. */
export const hubspotPartnerFieldSources: Readonly<
  Record<HubSpotPartnerField, { property: string; label: string }>
> = {
  name: { property: "name", label: "Company name" },
  website: { property: "website", label: "Website URL" },
  region: { property: "country", label: "Country/Region" },
};

export const hubspotFieldDecisions = ["keep", "use_hubspot", "clear"] as const;
export type HubSpotFieldDecision = (typeof hubspotFieldDecisions)[number];

const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        [...value].every((c) => {
          const code = c.charCodeAt(0);
          return code >= 32 && code !== 127;
        }),
      "control_character",
    );
const optionalLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (value) =>
        [...value].every((c) => {
          const code = c.charCodeAt(0);
          return code >= 32 && code !== 127;
        }),
      "control_character",
    )
    .default("");
const optionalId = z
  .union([z.guid(), z.literal(""), z.null()])
  .transform((value) => (value ? value : null))
  .default(null);

/** A digest of one reviewed source item, so a commit can tell it changed. */
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const HubSpotHandoffInputSchema = z
  .object({
    /** One handoff, however many times it is sent. */
    operationId: z.uuid(),
    /** The connection the review was read through; any change invalidates it. */
    connection: z.object({ id: z.guid(), version: z.int().min(1) }).strict(),
    source: z
      .object({
        companyId: HubSpotIdSchema,
        dealId: HubSpotIdSchema.nullable().default(null),
      })
      .strict(),
    /** Digests of the source as reviewed, by item key ("company", "deal",
     * "contact:<id>", "note:<id>", "file:<id>"). */
    reviewed: z.record(z.string().max(40), DigestSchema),
    destination: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("new_partner"),
          partnerId: z.uuid(),
          /** Proposed from HubSpot and editable; the source stays recorded. */
          name: line(200),
          website: optionalLine(500),
          region: optionalLine(500),
          status: z.enum(partnerStatuses).default("prospect"),
          ownerId: optionalId,
          models: z
            .array(z.enum(partnerModels))
            .max(partnerModels.length)
            .default([])
            .transform((models) =>
              partnerModels.filter((model) => models.includes(model)),
            ),
          /** Similar partners the person inspected and set aside, with why. */
          dismissedSuggestions: z
            .array(
              z.object({ partnerId: z.guid(), reason: line(300) }).strict(),
            )
            .max(10)
            .default([]),
        })
        .strict(),
      z
        .object({
          kind: z.literal("existing_partner"),
          partnerId: z.guid(),
          expectedVersion: z.int().min(1),
          /** A field left out takes its default; one changed on both sides
           * since the last import has none and must be decided. */
          fields: z
            .object({
              name: z.enum(hubspotFieldDecisions).optional(),
              website: z.enum(hubspotFieldDecisions).optional(),
              region: z.enum(hubspotFieldDecisions).optional(),
            })
            .strict()
            .default({}),
        })
        .strict(),
    ]),
    contacts: z
      .array(
        z
          .object({
            hubspotId: HubSpotIdSchema,
            /** An existing Commerce contact the person confirmed is this
             * person; the HubSpot identity is added and its values kept. */
            matchContactId: optionalId,
          })
          .strict(),
      )
      .max(hubspotLimits.contactsPerHandoff)
      .default([]),
    /** A HubSpot contact ID, a Commerce contact ID, or none. Never inferred. */
    primaryContact: z
      .union([
        z.object({ kind: z.literal("hubspot"), id: HubSpotIdSchema }).strict(),
        z.object({ kind: z.literal("commerce"), id: z.guid() }).strict(),
        z.null(),
      ])
      .default(null),
    includeDeal: z.boolean().default(false),
    /** The deal's other company the person chose as end customer. */
    endCustomerCompanyId: HubSpotIdSchema.nullable().default(null),
    notes: z
      .array(HubSpotIdSchema)
      .max(hubspotLimits.notesPerHandoff)
      .default([]),
    referenceProperties: z
      .array(
        z
          .object({
            objectType: z.enum(["company", "deal"]),
            name: propertyName,
          })
          .strict(),
      )
      .max(hubspotLimits.referencePropertiesPerHandoff)
      .default([]),
    documents: z
      .array(
        z
          .object({
            fileId: HubSpotIdSchema,
            title: line(200),
            kind: z.enum(accountDocumentKinds),
          })
          .strict(),
      )
      .max(hubspotLimits.documentsPerHandoff)
      .default([]),
  })
  .strict()
  .superRefine((input, ctx) => {
    const unique = (values: readonly string[], path: string) => {
      if (new Set(values).size !== values.length)
        ctx.addIssue({ code: "custom", path: [path], message: "duplicate" });
    };
    unique(
      input.contacts.map((contact) => contact.hubspotId),
      "contacts",
    );
    unique(input.notes, "notes");
    unique(
      input.documents.map((document) => document.fileId),
      "documents",
    );
    unique(
      input.referenceProperties.map((p) => `${p.objectType}:${p.name}`),
      "referenceProperties",
    );
    if (
      input.primaryContact?.kind === "hubspot" &&
      !input.contacts.some((c) => c.hubspotId === input.primaryContact?.id)
    )
      ctx.addIssue({
        code: "custom",
        path: ["primaryContact"],
        message: "primary_not_selected",
      });
    if (input.endCustomerCompanyId !== null) {
      if (!input.includeDeal || input.source.dealId === null)
        ctx.addIssue({
          code: "custom",
          path: ["endCustomerCompanyId"],
          message: "end_customer_needs_deal",
        });
      if (input.endCustomerCompanyId === input.source.companyId)
        ctx.addIssue({
          code: "custom",
          path: ["endCustomerCompanyId"],
          message: "end_customer_is_partner",
        });
    }
  });
export type HubSpotHandoffInput = z.infer<typeof HubSpotHandoffInputSchema>;

// ---------------------------------------------------------------------------
// What the handoff copies and keeps for reference: the source snapshot.
// ---------------------------------------------------------------------------

/** A source value as it was at import, with the property it came from. */
export interface HubSpotSourceValue {
  objectType: "company" | "deal";
  property: string;
  label: string;
  type: string;
  value: string | null;
}

export interface HubSpotCompanyReference {
  id: string;
  name: string;
  labels: readonly string[];
}

/** The originating deal, kept as context. It is an opportunity, not a
 * Commerce registration, and nothing derives protection or revenue from it. */
export interface HubSpotDealReference {
  id: string;
  url: string;
  name: string;
  pipeline: { id: string | null; label: string | null };
  stage: { id: string | null; label: string | null; closed: boolean | null };
  amount: string | null;
  currency: string | null;
  closeDate: string | null;
  owner: { id: string; name: string | null } | null;
  associatedCompanies: readonly HubSpotCompanyReference[];
  /** The company that became this Commerce partner. */
  chosenCompanyId: string;
  /** The company the person chose as end customer, if any. */
  endCustomer: HubSpotCompanyReference | null;
  updatedAt: string | null;
}

export interface HubSpotNoteReference {
  id: string;
  body: string;
  /** `null` when HubSpot did not say who wrote it. */
  authorName: string | null;
  timestamp: string | null;
}

export interface HubSpotSourceSnapshot {
  portalId: string;
  uiDomain: string;
  retrievedAt: string;
  company: {
    id: string;
    url: string;
    name: string;
    updatedAt: string | null;
    owner: { id: string; name: string | null } | null;
  };
  /** Values imported into fields, and values kept only for reference. */
  values: readonly HubSpotSourceValue[];
  deal: HubSpotDealReference | null;
  notes: readonly HubSpotNoteReference[];
}

// ---------------------------------------------------------------------------
// The plan: every addition, replacement, clear, reference and omission.
// ---------------------------------------------------------------------------

export type HubSpotFieldDrift =
  | "never_imported"
  | "unchanged"
  | "hubspot_changed"
  | "commerce_changed"
  | "both_changed";

/**
 * How a field moved since the last import. `lastSource` is HubSpot's value
 * then and `lastResult` what Commerce stored; `undefined` means the field was
 * never imported.
 */
export function classifyHubSpotDrift(input: {
  lastSource: string | undefined;
  lastResult: string | undefined;
  commerce: string;
  hubspot: string;
}): HubSpotFieldDrift {
  if (input.lastSource === undefined || input.lastResult === undefined)
    return "never_imported";
  const hubspotChanged = input.hubspot !== input.lastSource;
  const commerceChanged = input.commerce !== input.lastResult;
  if (hubspotChanged && commerceChanged) return "both_changed";
  if (hubspotChanged) return "hubspot_changed";
  if (commerceChanged) return "commerce_changed";
  return "unchanged";
}

/**
 * The decision the review starts with. Commerce values survive unless a
 * person selects a change: an empty Commerce field is filled, a change made
 * only in HubSpot is proposed, and a field both sides changed has no default
 * (`null`), so it cannot be committed until someone chooses.
 */
export function defaultHubSpotDecision(input: {
  drift: HubSpotFieldDrift;
  commerce: string;
  hubspot: string;
}): HubSpotFieldDecision | null {
  if (input.hubspot === "" || input.hubspot === input.commerce) return "keep";
  if (input.commerce === "") return "use_hubspot";
  if (input.drift === "hubspot_changed") return "use_hubspot";
  if (input.drift === "both_changed") return null;
  return "keep";
}

export type HubSpotFieldAction = "add" | "replace" | "clear" | "keep";

/** What each partner field was at the last import that included it. */
export type HubSpotFieldHistory = Partial<
  Record<HubSpotPartnerField, { lastSource: string; lastResult: string }>
>;

export interface HubSpotFieldChange {
  field: HubSpotPartnerField;
  action: HubSpotFieldAction;
  /** The Commerce value before. */
  current: string;
  /** HubSpot's value (after bounded normalization), `""` when empty. */
  hubspot: string;
  /** What Commerce stores after the import. */
  result: string;
  drift: HubSpotFieldDrift;
  source: { property: string; label: string; value: string | null };
}

/** A partner contact with its HubSpot identity. */
export interface HubSpotPlannedContact {
  id: string;
  hubspotId: string;
  name: string;
  email: string;
  role: string;
  labels: readonly string[];
  /** Linked to an existing Commerce contact whose values are kept. */
  matchedExisting: boolean;
}

export interface HubSpotPlannedDocument {
  fileId: string;
  noteId: string;
  fileName: string;
  title: string;
  kind: (typeof accountDocumentKinds)[number];
  size: number | null;
  updatedAt: string | null;
}

export interface HubSpotHandoffPlan {
  operationId: string;
  destination:
    | {
        kind: "new_partner";
        partnerId: string;
        name: string;
        status: (typeof partnerStatuses)[number];
        ownerId: string | null;
        ownerName: string | null;
        models: readonly (typeof partnerModels)[number][];
      }
    | {
        kind: "existing_partner";
        partnerId: string;
        name: string;
        expectedVersion: number;
      };
  fields: readonly HubSpotFieldChange[];
  contacts: readonly HubSpotPlannedContact[];
  /** The contact made primary, by local contact ID; `null` changes nothing. */
  primaryContactId: string | null;
  deal: HubSpotDealReference | null;
  notes: readonly HubSpotNoteReference[];
  /** Approved values retained as labeled context, not copied into fields. */
  references: readonly HubSpotSourceValue[];
  documents: readonly HubSpotPlannedDocument[];
  dismissedSuggestions: readonly { partnerId: string; reason: string }[];
  /** What the source offered that the person left out, by kind. */
  omitted: {
    contacts: number;
    notes: number;
    documents: number;
    properties: number;
  };
}

export interface HubSpotPlanCounts {
  create: boolean;
  added: number;
  replaced: number;
  cleared: number;
  kept: number;
  contactsAdded: number;
  contactsLinked: number;
  deals: number;
  notes: number;
  references: number;
  documents: number;
}

/** The counts the footer and the receipt both state, from one plan. */
export function countHubSpotPlan(plan: HubSpotHandoffPlan): HubSpotPlanCounts {
  const fields = (action: HubSpotFieldAction) =>
    plan.fields.filter((field) => field.action === action).length;
  return {
    create: plan.destination.kind === "new_partner",
    added: fields("add"),
    replaced: fields("replace"),
    cleared: fields("clear"),
    kept: fields("keep"),
    contactsAdded: plan.contacts.filter((c) => !c.matchedExisting).length,
    contactsLinked: plan.contacts.filter((c) => c.matchedExisting).length,
    deals: plan.deal ? 1 : 0,
    notes: plan.notes.length,
    references: plan.references.length,
    documents: plan.documents.length,
  };
}

/** Whether the plan changes anything beyond recording the link. */
export function hubspotPlanIsLinkOnly(plan: HubSpotHandoffPlan): boolean {
  const counts = countHubSpotPlan(plan);
  return (
    !counts.create &&
    counts.added + counts.replaced + counts.cleared === 0 &&
    counts.contactsAdded + counts.contactsLinked === 0 &&
    counts.deals + counts.notes + counts.references + counts.documents === 0 &&
    plan.primaryContactId === null
  );
}

/** The field action a decision produces against the current value. */
export function hubspotFieldAction(
  decision: HubSpotFieldDecision,
  current: string,
  hubspot: string,
): { action: HubSpotFieldAction; result: string } {
  if (decision === "clear")
    return current === ""
      ? { action: "keep", result: current }
      : { action: "clear", result: "" };
  // An empty or inaccessible source value never clears a Commerce value.
  if (decision === "keep" || hubspot === "" || hubspot === current)
    return { action: "keep", result: current };
  return { action: current === "" ? "add" : "replace", result: hubspot };
}

// ---------------------------------------------------------------------------
// Import records, items and links, as pages read them.
// ---------------------------------------------------------------------------

export const hubspotImportStatuses = [
  "complete",
  "needs_attention",
  "completed_with_exclusions",
] as const;
export type HubSpotImportStatus = (typeof hubspotImportStatuses)[number];

export const hubspotItemStatuses = [
  "pending",
  "attached",
  "failed",
  "duplicate",
  "reused",
  "excluded",
] as const;
export type HubSpotItemStatus = (typeof hubspotItemStatuses)[number];
/** Items that leave the handoff unfinished until someone acts. */
export const unresolvedHubSpotItemStatuses = [
  "pending",
  "failed",
  "duplicate",
] as const satisfies readonly HubSpotItemStatus[];

export interface HubSpotImportItem {
  id: string;
  importId: string;
  fileId: string;
  noteId: string;
  fileName: string;
  title: string;
  documentKind: (typeof accountDocumentKinds)[number];
  status: HubSpotItemStatus;
  /** Why the last attempt did not attach it. */
  errorCode: string | null;
  attachmentId: string | null;
  /** The identical PDF already on the record, for a duplicate. */
  existingAttachment: { id: string; title: string } | null;
  /** The attached document was removed from the partner afterwards. */
  attachmentRemoved: boolean;
  excludedReason: string | null;
  attempts: number;
  updatedAt: string;
}

export interface HubSpotImportRecord {
  id: string;
  partnerId: string;
  portalId: string;
  companyId: string;
  dealId: string | null;
  status: HubSpotImportStatus;
  /** The partner was created by this import rather than linked. */
  createdPartner: boolean;
  plan: HubSpotHandoffPlan;
  snapshot: HubSpotSourceSnapshot;
  items: readonly HubSpotImportItem[];
  createdById: string;
  createdByName: string;
  createdAt: string;
  completedAt: string | null;
}

export interface HubSpotLinkRecord {
  id: string;
  portalId: string;
  companyId: string;
  partnerId: string;
  partnerName: string;
  companyName: string;
  createdByName: string;
  createdAt: string;
}

/** The import's state from its items: never complete while one is open. */
export function hubspotImportStatus(
  items: readonly Pick<HubSpotImportItem, "status">[],
): HubSpotImportStatus {
  if (
    items.some((item) =>
      (unresolvedHubSpotItemStatuses as readonly string[]).includes(
        item.status,
      ),
    )
  )
    return "needs_attention";
  return items.some((item) => item.status === "excluded")
    ? "completed_with_exclusions"
    : "complete";
}

export const hubspotErrorCodes = [
  "HUBSPOT_NOT_CONFIGURED",
  "HUBSPOT_NOT_CONNECTED",
  "HUBSPOT_PORTAL_MISMATCH",
  "HUBSPOT_CONNECTION_CHANGED",
  "HUBSPOT_UNAVAILABLE",
  "HUBSPOT_RATE_LIMITED",
  "HUBSPOT_RECORD_NOT_FOUND",
  "HUBSPOT_RECORD_ARCHIVED",
  "HUBSPOT_SOURCE_CHANGED",
  "HUBSPOT_NOT_ASSOCIATED",
  "HUBSPOT_SCOPE_DENIED",
  "HUBSPOT_ALREADY_LINKED",
  "HUBSPOT_PARTNER_LINKED_ELSEWHERE",
  "HUBSPOT_OPERATION_CONFLICT",
  "HUBSPOT_CONTACT_LIMIT",
  "HUBSPOT_CONTACT_NOT_FOUND",
  "HUBSPOT_DOCUMENT_UNAVAILABLE",
  "HUBSPOT_DOCUMENT_CHANGED",
  "HUBSPOT_DOCUMENT_INVALID",
  "HUBSPOT_ITEM_NOT_FOUND",
  "HUBSPOT_ITEM_RESOLVED",
  "HUBSPOT_IMPORT_NOT_FOUND",
  "HUBSPOT_DECISION_REQUIRED",
  "HUBSPOT_CONNECTION_VERSION_CONFLICT",
  "HUBSPOT_NO_PIPELINES",
  "HUBSPOT_SIMILAR_PARTNER",
] as const;
export type HubSpotErrorCode = (typeof hubspotErrorCodes)[number];

// ---------------------------------------------------------------------------
// Pipeline: totals from the full authorized filtered result.
// ---------------------------------------------------------------------------

export const hubspotLinkFilters = ["any", "linked", "partly", "none"] as const;
export type HubSpotLinkFilter = (typeof hubspotLinkFilters)[number];
export const hubspotDealStates = ["open", "closed", "all"] as const;
export type HubSpotDealState = (typeof hubspotDealStates)[number];

const firstValue = (value: unknown): unknown =>
  Array.isArray(value)
    ? (value as unknown[])[0]
    : value === ""
      ? undefined
      : value;
const optionalParam = <T extends z.ZodType>(schema: T) =>
  z.preprocess(firstValue, schema.optional().catch(undefined));

/** Pipeline filters from the URL. Unknown values fall back to no filter. */
export const HubSpotPipelineQuerySchema = z.object({
  pipeline: optionalParam(z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)),
  stage: optionalParam(z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)),
  owner: optionalParam(HubSpotIdSchema),
  state: z.preprocess(
    firstValue,
    z.enum(hubspotDealStates).catch("open").default("open"),
  ),
  linked: z.preprocess(
    firstValue,
    z.enum(hubspotLinkFilters).catch("any").default("any"),
  ),
  closeFrom: optionalParam(z.iso.date()),
  closeTo: optionalParam(z.iso.date()),
  currency: optionalParam(z.string().regex(/^[A-Z]{3}$/)),
  q: z.preprocess(firstValue, z.string().trim().max(100).catch("")).default(""),
  view: z.preprocess(
    firstValue,
    z.enum(["table", "board"]).catch("table").default("table"),
  ),
  deal: optionalParam(HubSpotIdSchema),
});
export type HubSpotPipelineQuery = z.infer<typeof HubSpotPipelineQuerySchema>;

export function hubspotPipelineSearchParams(
  query: Partial<HubSpotPipelineQuery>,
): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: string | undefined) => {
    if (value) params.set(key, value);
  };
  set("pipeline", query.pipeline);
  set("stage", query.stage);
  set("owner", query.owner);
  if (query.state && query.state !== "open") params.set("state", query.state);
  if (query.linked && query.linked !== "any")
    params.set("linked", query.linked);
  set("closeFrom", query.closeFrom);
  set("closeTo", query.closeTo);
  set("currency", query.currency);
  set("q", query.q);
  if (query.view === "board") params.set("view", "board");
  set("deal", query.deal);
  return params;
}

/** A pipeline deal with its companies and their Commerce links. */
export interface HubSpotPipelineDeal {
  id: string;
  name: string;
  stageId: string | null;
  amount: string | null;
  currency: string | null;
  closeDate: string | null;
  ownerId: string | null;
  ownerName: string | null;
  updatedAt: string | null;
  companies: readonly {
    id: string;
    name: string;
    labels: readonly string[];
    partner: { id: string; name: string } | null;
  }[];
}

export interface HubSpotCurrencyTotal {
  currency: string;
  /** Decimal string, summed exactly. */
  amount: string;
  deals: number;
}

export interface HubSpotStageSummary {
  id: string;
  label: string;
  closed: boolean;
  deals: number;
  totals: readonly HubSpotCurrencyTotal[];
  missingAmounts: number;
}

export interface HubSpotPipelineSummary {
  deals: number;
  totals: readonly HubSpotCurrencyTotal[];
  missingAmounts: number;
  stages: readonly HubSpotStageSummary[];
}

const decimalPattern = /^-?\d{1,15}(?:\.\d{1,6})?$/;
const scale = 1_000_000n;

function toScaled(value: string): bigint | null {
  const text = value.trim();
  if (!decimalPattern.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = text.replace("-", "").split(".");
  const scaled =
    BigInt(whole) * scale + BigInt(fraction.padEnd(6, "0").slice(0, 6));
  return negative ? -scaled : scaled;
}

function fromScaled(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(6, "0");
  const trimmed = fraction.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${trimmed ? `.${trimmed}` : ""}`;
}

/** Whether a deal's amount can be summed: a plain decimal with a currency. */
export function hubspotAmountKnown(
  deal: Pick<HubSpotPipelineDeal, "amount" | "currency">,
): boolean {
  return (
    deal.amount !== null &&
    deal.currency !== null &&
    toScaled(deal.amount) !== null
  );
}

function sumByCurrency(
  deals: readonly Pick<HubSpotPipelineDeal, "amount" | "currency">[],
): HubSpotCurrencyTotal[] {
  const totals = new Map<string, { amount: bigint; deals: number }>();
  for (const deal of deals) {
    if (!hubspotAmountKnown(deal)) continue;
    const currency = deal.currency ?? "";
    const entry = totals.get(currency) ?? { amount: 0n, deals: 0 };
    entry.amount += toScaled(deal.amount ?? "0") ?? 0n;
    entry.deals += 1;
    totals.set(currency, entry);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, entry]) => ({
      currency,
      amount: fromScaled(entry.amount),
      deals: entry.deals,
    }));
}

/**
 * Stage counts and totals over every deal given, counting each deal once by
 * ID. Amounts are grouped by currency and never combined across currencies;
 * a deal without a usable amount or currency is counted as missing, not 0.
 */
export function summarizeHubSpotPipeline(
  pipeline: Pick<HubSpotPipeline, "stages">,
  deals: readonly HubSpotPipelineDeal[],
): HubSpotPipelineSummary {
  const unique = [...new Map(deals.map((deal) => [deal.id, deal])).values()];
  const missing = (rows: readonly HubSpotPipelineDeal[]) =>
    rows.filter((deal) => !hubspotAmountKnown(deal)).length;
  const stages = [...pipeline.stages]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((stage) => {
      const rows = unique.filter((deal) => deal.stageId === stage.id);
      return {
        id: stage.id,
        label: stage.label,
        closed: stage.closed,
        deals: rows.length,
        totals: sumByCurrency(rows),
        missingAmounts: missing(rows),
      };
    });
  return {
    deals: unique.length,
    totals: sumByCurrency(unique),
    missingAmounts: missing(unique),
    stages,
  };
}

/** How many of a deal's companies are linked in Commerce. */
export function hubspotDealLinkState(
  deal: Pick<HubSpotPipelineDeal, "companies">,
): Exclude<HubSpotLinkFilter, "any"> {
  const linked = deal.companies.filter((company) => company.partner).length;
  if (linked === 0) return "none";
  return linked === deal.companies.length ? "linked" : "partly";
}

/** JSON with object keys sorted, so equal values have one spelling. */
export function canonicalHubSpotJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : item,
  );
}
