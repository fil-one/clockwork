import "server-only";

import type { Route } from "next";

import { getCommerceSession } from "@/src/auth/session";
import type {
  CommercialRecord,
  CollectionKind,
} from "@/src/features/customer-partner/commercial/model";
import type { CustomerCollectionRecord } from "@/src/features/customer-partner/customer/collection-state";
import type { CustomerCollectionKey } from "@/src/features/customer-partner/customer/customer-data";
import type {
  PartnerRecord,
  PartnerSurfaceKey,
} from "@/src/features/customer-partner/partner/partner-data";

import {
  ExperienceProblem,
  type ExperienceAudience,
  type ProjectionChannel,
  type ProjectionRecord,
} from "./model";
import {
  configuredProjectionSource,
  projectionInput,
} from "./projection-source";

export interface PortalRecords<T> {
  records: readonly T[];
  generatedAt: string;
  stale: boolean;
  recordCount: number;
  pagesRead: number;
}

function text(data: Readonly<Record<string, unknown>>, key: string): string {
  const value = data[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Projection record omitted ${key}`);
  return value;
}

function number(data: Readonly<Record<string, unknown>>, key: string): number {
  const value = data[key];
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`Projection record omitted ${key}`);
  return value;
}

function oneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  field: string,
): T {
  const match = allowed.find((candidate) => candidate === value);
  if (!match) throw new Error(`Projection field ${field} is invalid`);
  return match;
}

export function recordRoute(
  channel: CollectionKind,
  recordKey: string,
): string {
  const encoded = encodeURIComponent(recordKey);
  return channel === "services" ? "/services" : `/${channel}/${encoded}`;
}

/**
 * Projection records carry `context` as `{label,value}` entries. Customer
 * collections render the entries individually; partner surfaces render one
 * line, so the entries are joined here rather than duplicated in the payload.
 * Demo fixtures still supply a pre-formatted string.
 */
function contextEntries(
  data: Readonly<Record<string, unknown>>,
): { label: string; value: string }[] {
  const raw = data.context;
  if (!Array.isArray(raw)) throw new Error("Projection record omitted context");
  return raw.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("Projection context is invalid");
    const entry = item as Readonly<Record<string, unknown>>;
    return { label: text(entry, "label"), value: text(entry, "value") };
  });
}

function contextLine(data: Readonly<Record<string, unknown>>): string {
  if (typeof data.context === "string" && data.context.trim())
    return data.context;
  const joined = contextEntries(data)
    .map((entry) => `${entry.label} ${entry.value}`)
    .join(" · ");
  return joined || "Not recorded";
}

function portalAccountId(
  audience: ExperienceAudience,
  session: Awaited<ReturnType<typeof getCommerceSession>>,
): string | null {
  if (audience === "internal") return null;
  return (
    session.impersonation?.accountId ??
    session.selectedAccountId ??
    session.accountIds[0] ??
    null
  );
}

/** Read every bounded server page so UI pagination never falls back to fixtures. */
export async function loadPortalRecords(
  audience: ExperienceAudience,
  channel: ProjectionChannel,
  presetSession?: Awaited<ReturnType<typeof getCommerceSession>>,
): Promise<PortalRecords<ProjectionRecord>> {
  const session = presetSession ?? (await getCommerceSession());
  const source = configuredProjectionSource();
  const records: ProjectionRecord[] = [];
  let cursor: string | undefined;
  let generatedAt = new Date().toISOString();
  let pagesRead = 0;
  do {
    const page = await source.list(
      projectionInput({
        session,
        audience,
        channel,
        requestedAccountId: portalAccountId(audience, session),
        ...(cursor ? { cursor } : {}),
        limit: 100,
      }),
    );
    records.push(...page.items);
    generatedAt = page.generatedAt;
    cursor = page.nextCursor ?? undefined;
    pagesRead += 1;
    if (pagesRead >= 100 && cursor)
      throw new Error("Projection pagination exceeded the bounded page limit");
  } while (cursor);
  return {
    records,
    generatedAt,
    stale: records.some((record) => record.stale),
    recordCount: records.length,
    pagesRead,
  };
}

function commercialRecord(
  record: ProjectionRecord,
  kind: CollectionKind,
): CommercialRecord {
  const data = record.data;
  if (text(data, "kind") !== kind)
    throw new Error("Commercial projection channel binding is invalid");
  return {
    id: text(data, "id"),
    kind,
    title: text(data, "title"),
    description: text(data, "description"),
    status: text(data, "status"),
    statusLabel: text(data, "statusLabel"),
    tone: oneOf(
      text(data, "tone"),
      ["neutral", "success", "warning", "danger"],
      "tone",
    ),
    risk: oneOf(text(data, "risk"), ["low", "medium", "high"], "risk"),
    owner: text(data, "owner"),
    value: text(data, "value"),
    valueLabel: text(data, "valueLabel"),
    updatedAt: record.sourceUpdatedAt,
    dateLabel: text(data, "dateLabel"),
    href: recordRoute(kind, record.recordKey),
    term: text(data, "term"),
    nextAction: text(data, "nextAction"),
    version: String(record.version),
    projectionId: record.id,
    aggregateId: record.aggregateId,
    allowedActions: Array.isArray(data.allowedActions)
      ? data.allowedActions.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
  };
}

export async function loadCommercialRecords(kind: CollectionKind) {
  const page = await loadPortalRecords("customer", kind);
  return {
    ...page,
    records: page.records.map((record) => commercialRecord(record, kind)),
  };
}

/**
 * The one failure a record read is allowed to turn into an absence.
 *
 * The projection lookup filters on `audience_account_id` and the
 * `experience_projection_read` row-level policy repeats the same account test,
 * so a record belonging to another account produces no row -- exactly what a
 * record that was never written produces. Both surface as
 * `PROJECTION_NOT_FOUND`, the only 404 either projection source raises from a
 * detail read. Collapsing them here is what keeps them one outcome: if the two
 * were told apart anywhere above this line, the difference would be an
 * enumeration oracle for another tenant's identifiers.
 *
 * Nothing else is absence. A 401, 403, 409, 410, 422, 502 or 503, and every
 * error that is not an `ExperienceProblem` at all -- a malformed payload from
 * `text()`/`number()`/`oneOf()`, a database failure, a bug -- still throws.
 */
function isProjectionAbsent(error: unknown): boolean {
  return error instanceof ExperienceProblem && error.status === 404;
}

/**
 * Resolves to `null` when the record is absent or outside the caller's
 * account, so the route can render the branded not-found state instead of the
 * fatal error boundary.
 *
 * `commercialRecord` is deliberately outside the `try`: a row that exists but
 * whose payload does not satisfy the presentation contract is a materializer
 * defect, and reporting it as "not found" would hide it behind a state the
 * reader is expected to see.
 */
export async function loadCommercialRecord(
  kind: CollectionKind,
  recordKey: string,
): Promise<CommercialRecord | null> {
  const session = await getCommerceSession();
  let record: ProjectionRecord;
  try {
    record = await configuredProjectionSource().find({
      session,
      audience: "customer",
      channel: kind,
      accountId: portalAccountId("customer", session),
      recordKey,
      now: new Date(),
    });
  } catch (error) {
    if (isProjectionAbsent(error)) return null;
    throw error;
  }
  return commercialRecord(record, kind);
}

function partnerRecord(
  record: ProjectionRecord,
  surface: PartnerSurfaceKey,
): PartnerRecord {
  const data = record.data;
  return {
    id: text(data, "id"),
    name: text(data, "name"),
    context: contextLine(data),
    status: oneOf(
      text(data, "status"),
      [
        "active",
        "attention",
        "draft",
        "open",
        "accepted",
        "canceled",
        "pending",
        "paid",
        "blocked",
        "complete",
      ],
      "status",
    ),
    risk: oneOf(text(data, "risk"), ["low", "medium", "high"], "risk"),
    owner: text(data, "owner"),
    value: text(data, "value"),
    secondary: text(data, "secondary"),
    ...(["portfolio", "quotes"].includes(surface)
      ? {
          href: `/partner/${surface}/${encodeURIComponent(record.recordKey)}` as Route,
        }
      : {}),
    recordVersion: record.version,
    projectionId: record.id,
    recordKey: record.recordKey,
    allowedActions: Array.isArray(data.allowedActions)
      ? data.allowedActions.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
  };
}

export async function loadPartnerRecords(surface: PartnerSurfaceKey) {
  const page = await loadPortalRecords("partner", surface);
  return {
    ...page,
    records: page.records.map((record) => partnerRecord(record, surface)),
  };
}

function customerRecord(record: ProjectionRecord): CustomerCollectionRecord {
  const data = record.data;
  return {
    id: text(data, "id"),
    title: text(data, "title"),
    description: text(data, "description"),
    status: oneOf(
      text(data, "status"),
      ["active", "pending", "review", "complete", "blocked"],
      "status",
    ),
    statusLabel: text(data, "statusLabel"),
    risk: oneOf(text(data, "risk"), ["low", "medium", "high"], "risk"),
    owner: text(data, "owner"),
    value: text(data, "value"),
    valueSort: number(data, "valueSort"),
    updatedAt: record.sourceUpdatedAt,
    updatedLabel: text(data, "updatedLabel"),
    context: contextEntries(data),
    recordVersion: record.version,
    projectionId: record.id,
    aggregateId: record.aggregateId,
  };
}

export async function loadCustomerCollectionRecords(
  key: CustomerCollectionKey,
) {
  const page = await loadPortalRecords("customer", key);
  return {
    ...page,
    records: page.records.map(customerRecord),
  };
}
