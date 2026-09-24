import { formatMoney } from "@/src/features/shared/format";
import "server-only";

import { formattingLocales, type Translator } from "@/src/i18n";
import { getLocale, getTranslations } from "@/src/i18n/server";

import type { Route } from "next";

import { hasPermission, uuidV7 } from "@clockwork/contracts";
import {
  findActiveCustomerQuoteOffers,
  findCustomerQuoteCurrency,
  findPreparedOrderForm,
  findPreparedQuoteArtifact,
  withAuthorizedTransaction,
  withInternalTransaction,
} from "@clockwork/db";

import {
  explicitDemoIdentityEnabled,
  getCommerceSession,
} from "@/src/auth/session";
import {
  getOptionalRuntimeDatabase,
  getOptionalServiceDatabase,
} from "@/src/db/service";
import type { QuoteOfferOption } from "@/src/features/customer-partner/commercial/workflow-model";
import {
  isOrderLifecycleStatus,
  type CommercialRecord,
  type CollectionKind,
  type OrderLifecycleStatus,
} from "@/src/features/customer-partner/commercial/model";
import { commercialFactsField } from "@/src/features/customer-partner/commercial/record-facts";
import type { PreparedOrderFormLookup } from "@/src/features/customer-partner/commercial/prepared-order-form";
import {
  partnerMilestoneText,
  partnerPositionText,
  readPartnerMilestone,
  readPartnerPosition,
} from "@/src/features/customer-partner/partner/partner-presentation";
import type {
  BuyQuoteProjectionLookup,
  PreparedQuoteArtifactLookup,
} from "@/src/features/customer-partner/commercial/prepared-quote-artifact";
import { customerCollectionRecord } from "@/src/features/customer-partner/customer/collection-record";
import type { CustomerCollectionKey } from "@/src/features/customer-partner/customer/customer-data";
import type {
  PartnerRecord,
  PartnerSurfaceKey,
} from "@/src/features/customer-partner/partner/partner-data";
import { runtimeTelemetry } from "@/src/telemetry/runtime";

import {
  ExperienceProblem,
  type ExperienceAudience,
  type ProjectionChannel,
  type ProjectionOrder,
  type ProjectionRecord,
} from "./model";
import { authorizationContext } from "./authorization";
import { demoOrderAcceptance } from "./demo-order-acceptance";
import { demoCustomerQuoteOffers } from "./demo-quote-offers";
import { configuredDemoStateStore } from "./demo-state-store";
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
  /**
   * Set when the channel held more than this read returned. A surface that
   * builds facets, totals or "the one active record" from `records` is looking
   * at a prefix, not the set, and has to say so.
   */
  truncated: boolean;
}

function text(data: Readonly<Record<string, unknown>>, key: string): string {
  const value = data[key];
  if (typeof value !== "string" || !value.trim())
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

/**
 * Where a commercial record's detail page lives. Both halves are load-bearing;
 * neither holds on its own.
 *
 * `Route<T>` alone is not a guard. `RouteImpl<T>` in `.next/types/link.d.ts` is
 * `StaticRoutes | SearchOrHash | WithProtocol | `${StaticRoutes}${SearchOrHash}`
 * | (T extends `${DynamicRoutes<infer _>}${Suffix}` ? T : never)`, and the
 * first four members never mention `T`. `Route<anything>` therefore admits
 * every static route the app declares, every string containing a colon, and
 * every string opening with `?` or `#`. Annotated with `Route<...>` and nothing
 * else, the body that shipped the defect --
 * `return channel === "services" ? "/services" : ...` -- recompiles with zero
 * errors, because `/services` is a static route. That is measured, not
 * reasoned: restoring that body under the bare alias exits `tsc` 0.
 *
 * The `& `/${CollectionKind}/${string}`` half is what rejects it, because a
 * collection path has no second segment. Together the two halves hold:
 *
 * 1. the value is a record path beneath a channel, so answering with the
 *    collection path is a build error (`TS2322: Type '"/services"' is not
 *    assignable to type 'CommercialRecordRoute'`);
 * 2. every `CollectionKind` has an `[id]` page. Add a kind without one, or
 *    delete an `[id]` page a kind still links to, and `RouteImpl`'s conditional
 *    branch yields `never` for that kind, so the template the body builds stops
 *    being assignable.
 *
 * What it does not hold: that the *record key* is what gets interpolated, or
 * that the key is encoded. `/${kind}/index` satisfies this type. Those two are
 * held per kind by `portal-view-loader.test.ts`, which is where the defect that
 * started this -- `services` linking rows to the page the reader was already on
 * -- is caught if the type is ever loosened again.
 */
export type CommercialRecordRoute = Route<`/${CollectionKind}/${string}`> &
  `/${CollectionKind}/${string}`;

export function recordRoute(
  channel: CollectionKind,
  recordKey: string,
): CommercialRecordRoute {
  return `/${channel}/${encodeURIComponent(recordKey)}`;
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

function authoritativeOrderLifecycleStatus(
  data: Readonly<Record<string, unknown>>,
): OrderLifecycleStatus | null {
  const authoritative = data.authoritative;
  if (
    !authoritative ||
    typeof authoritative !== "object" ||
    Array.isArray(authoritative)
  )
    return null;
  const status = (authoritative as Readonly<Record<string, unknown>>).status;
  return isOrderLifecycleStatus(status) ? status : null;
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

export type CustomerQuoteOffersLookup =
  | {
      status: "available";
      catalogueMode: "authoritative" | "simulated";
      offers: readonly QuoteOfferOption[];
    }
  | { status: "unavailable" }
  | { status: "forbidden" };

/**
 * Loads only rate cards the selected account can actually quote against.
 * Account visibility and currency are read on the tenant pool; price-book
 * metadata is read on the service pool only after that scoped fact exists.
 * No price amount crosses this boundary.
 */
export async function loadCustomerQuoteOffers(): Promise<CustomerQuoteOffersLookup> {
  if (explicitDemoIdentityEnabled())
    return {
      status: "available",
      catalogueMode: "authoritative",
      offers: demoCustomerQuoteOffers(await configuredDemoStateStore().read()),
    };
  const session = await getCommerceSession();
  const permitted = session.roles.some((role) =>
    hasPermission(role, "quote:write"),
  );
  if (!permitted) return { status: "forbidden" };
  const accountId = portalAccountId("customer", session);
  const runtime = getOptionalRuntimeDatabase();
  const service = getOptionalServiceDatabase();
  const secret = process.env.AUTHORIZATION_CONTEXT_SECRET?.trim();
  if (!accountId || !runtime || !service || !secret || secret.length < 32)
    return { status: "unavailable" };
  const currency = await withAuthorizedTransaction(
    runtime,
    authorizationContext(session, `quote-offer-account:${uuidV7()}`),
    { secret },
    (transaction) => findCustomerQuoteCurrency(transaction, { accountId }),
  );
  if (!currency) return { status: "forbidden" };
  const rows = await withInternalTransaction(
    service,
    `quote-offers:${uuidV7()}`,
    (transaction) =>
      findActiveCustomerQuoteOffers(transaction, {
        currency,
        now: new Date(),
      }),
  );
  const offers = rows.map((row) => ({
    id: `${row.price_book_id}:${row.sku}:${row.region}`,
    priceBookId: row.price_book_id,
    sku: row.sku,
    region: row.region,
    currency: row.currency,
    label: `${row.approved_claim} · ${row.sku} · ${row.region} · ${row.price_book_name} v${row.version}`,
    description: `${row.currency} · active price-book version ${row.version}`,
  }));
  if (
    new Set(offers.map((offer) => offer.id)).size !== offers.length ||
    new Set(offers.map((offer) => offer.label.toLocaleLowerCase())).size !==
      offers.length
  )
    throw new Error("Active quote catalogue contains ambiguous offers");
  return {
    status: "available",
    catalogueMode: "authoritative",
    offers,
  };
}

export const PROJECTION_PAGE_SIZE = 100;

/**
 * How many pages one full read will walk before it stops and says so.
 *
 * `PROJECTION_PAGE_SIZE * MAX_PROJECTION_PAGES` records is the ceiling.
 */
export const MAX_PROJECTION_PAGES = 100;

/**
 * The page-limit ceiling used to `throw`, which turned an account that had
 * simply grown past ten thousand records in one channel into a route that
 * could not be opened at all. Refusing a legitimate read is the same class of
 * defect as returning a wrong one, so the read now stops, reports what it got,
 * and raises an operational signal instead.
 *
 * The span carries an error status because a truncated portal read is an
 * operational condition an operator has to act on -- the channel needs a
 * materializer or a narrower surface -- not a user error. `clockwork.boundary`
 * is `db` so it lands under the existing `runtime-db-pitr` error-ratio alert;
 * a dedicated rule keyed on `error.code` would page more precisely.
 *
 * Telemetry never changes control flow: a sink outage must not turn a
 * successful partial read into a failed one.
 */
function reportTruncatedRead(input: {
  audience: ExperienceAudience;
  channel: ProjectionChannel;
}): void {
  try {
    // `TelemetryAttributes` is an allowlist and drops anything else, so the
    // channel travels in `db.operation.name`. The record count would carry no
    // information anyway: a truncated read is always exactly
    // `PROJECTION_PAGE_SIZE * MAX_PROJECTION_PAGES` records.
    void runtimeTelemetry
      .startSpan({
        boundary: "db",
        name: "projection.read_truncated",
        attributes: {
          "clockwork.operation": "projection.read_truncated",
          "clockwork.outcome": "error",
          "error.type": "ProjectionReadTruncated",
          "error.code": "PROJECTION_READ_TRUNCATED",
          "db.operation.name": `projection_read:${input.audience}:${input.channel}`,
          "db.system.name": "postgresql",
        },
      })
      .end("error");
  } catch {
    // A telemetry failure must not deny the reader the records that were read.
  }
}

/**
 * Read every bounded server page so UI pagination never falls back to
 * fixtures.
 *
 * The full read is load-bearing and deliberate: collection surfaces build
 * their status and owner facets from the whole set and filter server-side from
 * URL state, so a lazy per-page read would silently narrow the facets to
 * whatever page happened to load. Surfaces that want a prefix rather than the
 * set should call `loadTopPortalRecords`, which asks the server for the
 * ordering and the limit instead of slicing a full read.
 */
export async function loadPortalRecords(
  audience: ExperienceAudience,
  channel: ProjectionChannel,
  presetSession?: Awaited<ReturnType<typeof getCommerceSession>>,
): Promise<PortalRecords<ProjectionRecord>> {
  const session = presetSession ?? (await getCommerceSession());
  const locale = await getLocale();
  const source = configuredProjectionSource();
  const records: ProjectionRecord[] = [];
  let cursor: string | undefined;
  let generatedAt = new Date().toISOString();
  let pagesRead = 0;
  let truncated = false;
  do {
    const page = await source.list(
      projectionInput({
        session,
        audience,
        channel,
        requestedAccountId: portalAccountId(audience, session),
        ...(cursor ? { cursor } : {}),
        limit: PROJECTION_PAGE_SIZE,
        locale,
      }),
    );
    records.push(...page.items);
    generatedAt = page.generatedAt;
    cursor = page.nextCursor ?? undefined;
    pagesRead += 1;
    if (pagesRead >= MAX_PROJECTION_PAGES && cursor) {
      truncated = true;
      cursor = undefined;
      reportTruncatedRead({ audience, channel });
    }
  } while (cursor);
  return {
    records,
    generatedAt,
    // A truncated read is stale by construction: the newest page is present
    // but the tail is not, so anything derived from the whole set is behind.
    stale: truncated || records.some((record) => record.stale),
    recordCount: records.length,
    pagesRead,
    truncated,
  };
}

/**
 * One server page, in the ordering the caller asked for.
 *
 * This is the top-N read: `order by` and `limit` go to the database, so a
 * surface that wants the twenty most recent records reads twenty rows. It is
 * not a slice of a full read, and it must not be used where the surface needs
 * the whole set -- facets, totals, and "is there an active one anywhere"
 * answers are wrong when computed from a prefix, which is why `truncated`
 * comes back set whenever the channel held more.
 */
export async function loadTopPortalRecords(
  audience: ExperienceAudience,
  channel: ProjectionChannel,
  options: { limit: number; orderBy: ProjectionOrder },
  presetSession?: Awaited<ReturnType<typeof getCommerceSession>>,
): Promise<PortalRecords<ProjectionRecord>> {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1)
    throw new Error("Projection top-N limit must be a positive integer");
  const session = presetSession ?? (await getCommerceSession());
  const page = await configuredProjectionSource().list(
    projectionInput({
      session,
      audience,
      channel,
      requestedAccountId: portalAccountId(audience, session),
      limit: Math.min(options.limit, PROJECTION_PAGE_SIZE),
      orderBy: options.orderBy,
      locale: await getLocale(),
    }),
  );
  const truncated = page.nextCursor !== null;
  return {
    records: page.items,
    generatedAt: page.generatedAt,
    stale: truncated || page.items.some((record) => record.stale),
    recordCount: page.items.length,
    pagesRead: 1,
    truncated,
  };
}

/**
 * Whether the order form an acceptance in progress is waiting on exists yet.
 *
 * This is deliberately *not* a projection read. `orders:prepare_artifact`
 * writes no order row -- `mutateOrder`'s create branch is the only writer of
 * `public.orders` and of `orders.order_form_document_id` -- and the orders
 * channel projects `public.orders`. So the surface that used to look for the
 * prepared document on the orders channel was waiting for a value that cannot
 * exist until after the command the document is a precondition for. The
 * binding between the two passes lives on the artifact request, and that is
 * what this reads.
 *
 * Row-level security is the account scope: `core_commercial_artifact_select`
 * admits the audience account, and the transaction runs under the caller's own
 * authorization context. The identifier handed back is only useful to a caller
 * who can also satisfy `assertCommercialArtifactBinding` on the create pass,
 * which re-checks the subject, the audience, the document kind and the source
 * hash inside the accepting transaction.
 *
 * `unavailable` rather than a throw when nothing is composed: a deployment
 * without an authoritative database cannot render order forms at all, and
 * reporting that as "still rendering" would leave the reader polling something
 * that is never coming.
 *
 * THE DEMO ADAPTER USED TO BE IN THAT SENTENCE, AND IT NO LONGER IS. The early
 * return said a demo deployment "cannot render order forms at all", and that
 * stopped being true: the demo renders all nineteen catalogue artifact kinds
 * through the product's own renderer, and `DemoOrderAcceptance.prepare` records
 * a real artifact request bound to the order the first pass named. Returning
 * `unavailable` unconditionally was therefore the only reason the demo's
 * acceptance journey dead-ended — every prospect who reached the second pass
 * was told the workspace could not answer a question it could answer.
 */
export async function loadPreparedOrderForm(
  orderId: string,
): Promise<PreparedOrderFormLookup> {
  if (process.env.CLOCKWORK_EXPERIENCE_ADAPTER?.trim() === "demo") {
    const prepared = await demoOrderAcceptance().preparedOrderForm(orderId);
    return prepared
      ? {
          status: "stored",
          documentId: prepared.documentId,
          artifactId: prepared.artifactId,
        }
      : { status: "pending" };
  }
  const database = getOptionalRuntimeDatabase();
  const secret = process.env.AUTHORIZATION_CONTEXT_SECRET?.trim();
  if (!database || !secret || secret.length < 32)
    return { status: "unavailable" };
  const session = await getCommerceSession();
  const prepared = await withAuthorizedTransaction(
    database,
    authorizationContext(session, `prepared-order-form:${uuidV7()}`),
    { secret },
    (transaction) => findPreparedOrderForm(transaction, { orderId }),
  );
  return prepared
    ? {
        status: "stored",
        documentId: prepared.documentId,
        artifactId: prepared.artifactId,
      }
    : { status: "pending" };
}

/** The stored direct-quote document between prepare and issue. */
export async function loadPreparedQuoteArtifact(
  quoteId: string,
): Promise<PreparedQuoteArtifactLookup> {
  if (process.env.CLOCKWORK_EXPERIENCE_ADAPTER?.trim() === "demo")
    return { status: "unavailable" };
  const database = getOptionalRuntimeDatabase();
  const secret = process.env.AUTHORIZATION_CONTEXT_SECRET?.trim();
  if (!database || !secret || secret.length < 32)
    return { status: "unavailable" };
  const session = await getCommerceSession();
  const prepared = await withAuthorizedTransaction(
    database,
    authorizationContext(session, `prepared-quote-artifact:${uuidV7()}`),
    { secret },
    (transaction) => findPreparedQuoteArtifact(transaction, { quoteId }),
  );
  return prepared
    ? {
        status: "stored",
        documentId: prepared.documentId,
        artifactId: prepared.artifactId,
      }
    : { status: "pending" };
}

function optionalProjectionText(
  data: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Confirms the exact quote projection used for the order handoff. Looking up
 * by `recordKey`, rather than reading the collection and falling back, makes a
 * delayed materializer an honest pending state instead of a different quote.
 */
export async function loadBuyQuoteProjection(
  quoteId: string,
): Promise<BuyQuoteProjectionLookup> {
  const session = await getCommerceSession();
  let record: ProjectionRecord;
  try {
    record = await configuredProjectionSource().find({
      session,
      audience: "customer",
      channel: "quotes",
      accountId: portalAccountId("customer", session),
      recordKey: `quote-${quoteId}`,
      now: new Date(),
      locale: await getLocale(),
    });
  } catch (error) {
    if (isProjectionAbsent(error)) return { status: "pending" };
    throw error;
  }
  if (record.aggregateId !== quoteId) return { status: "pending" };
  const authoritative = record.data.authoritative;
  if (
    !authoritative ||
    typeof authoritative !== "object" ||
    Array.isArray(authoritative)
  )
    return { status: "pending" };
  const facts = authoritative as Readonly<Record<string, unknown>>;
  const currency = optionalProjectionText(facts, "currency");
  const supportedCurrency =
    currency === "USD" || currency === "EUR" || currency === "GBP"
      ? currency
      : undefined;
  const totalMinor = optionalProjectionText(facts, "totalMinor");
  const marginResult = optionalProjectionText(facts, "marginFloorResult");
  return {
    status: "found",
    quoteStatus: optionalProjectionText(facts, "status") ?? "unknown",
    rowVersion: record.version,
    ...(totalMinor && /^-?\d+$/.test(totalMinor) ? { totalMinor } : {}),
    ...(supportedCurrency ? { currency: supportedCurrency } : {}),
    ...(marginResult ? { marginResult } : {}),
  };
}

function displayVersionValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : undefined;
}

function commercialDisplayVersion(
  data: Readonly<Record<string, unknown>>,
  kind: CollectionKind,
): string | undefined {
  const direct = displayVersionValue(data.version);
  if (direct) return direct;
  if (kind !== "quotes") return undefined;
  const authoritative = data.authoritative;
  if (
    !authoritative ||
    typeof authoritative !== "object" ||
    Array.isArray(authoritative)
  )
    return undefined;
  return displayVersionValue(
    (authoritative as Readonly<Record<string, unknown>>).revision,
  );
}

function commercialRecord(
  record: ProjectionRecord,
  kind: CollectionKind,
): CommercialRecord {
  const data = record.data;
  if (text(data, "kind") !== kind)
    throw new Error("Commercial projection channel binding is invalid");
  const displayVersion = commercialDisplayVersion(data, kind);
  const reference = optionalProjectionText(data, "reference");
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
    nextAction:
      typeof data.nextActionHref === "string" &&
      /^Track order [a-f0-9-]+$/u.test(text(data, "nextAction"))
        ? "Track your order"
        : text(data, "nextAction"),
    ...(typeof data.nextActionHref === "string" &&
    /^\/orders\/order-[a-f0-9-]+$/u.test(data.nextActionHref)
      ? { nextActionHref: data.nextActionHref }
      : {}),
    ...(displayVersion ? { version: displayVersion } : {}),
    ...(reference ? { reference } : {}),
    projectionVersion: record.version,
    projectionId: record.id,
    aggregateId: record.aggregateId,
    allowedActions: Array.isArray(data.allowedActions)
      ? data.allowedActions.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    ...(kind === "orders"
      ? {
          orderLifecycleStatus: authoritativeOrderLifecycleStatus(data),
        }
      : {}),
    ...commercialFactsField(data),
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
      locale: await getLocale(),
    });
  } catch (error) {
    if (isProjectionAbsent(error)) return null;
    throw error;
  }
  return commercialRecord(record, kind);
}

/**
 * Partner surfaces that mount a record detail page.
 *
 * A type predicate rather than an inline `includes`, because `includes` does
 * not narrow: the previous `["portfolio", "quotes"].includes(surface)` left
 * `surface` as the whole `PartnerSurfaceKey` union, which is why the href it
 * guarded needed an `as Route` cast, and why a surface with no `[id]` route
 * could have been added to that list without anything failing.
 */
const partnerDetailSurfaces = ["portfolio", "quotes"] as const;
type PartnerDetailSurface = (typeof partnerDetailSurfaces)[number];

function mountsPartnerDetail(
  surface: PartnerSurfaceKey,
): surface is PartnerDetailSurface {
  return (partnerDetailSurfaces as readonly PartnerSurfaceKey[]).includes(
    surface,
  );
}

/**
 * The annotated local is the check: it resolves to a dynamic-segment route
 * only while `/partner/portfolio/[id]` and `/partner/quotes/[id]` both exist.
 *
 * The widening on the return is the one cast left in this file, and it is
 * downstream of that check rather than in place of it. It is here only because
 * `PartnerRecord.href` is declared as the bare `Route`, which by construction
 * cannot express a dynamic segment; narrowing that field to
 * `Route<`/partner/${PartnerDetailSurface}/${string}`>` removes the cast, and
 * that file belongs to another lane.
 */
function partnerDetailRoute(
  surface: PartnerDetailSurface,
  recordKey: string,
): Route {
  const href: Route<`/partner/${PartnerDetailSurface}/${string}`> = `/partner/${surface}/${encodeURIComponent(recordKey)}`;
  return href as Route;
}

function partnerQuotePricing(
  data: Readonly<Record<string, unknown>>,
  formatting: string,
): PartnerRecord["quotePricing"] {
  const value = data.authoritative;
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const facts = value as Record<string, unknown>;
  const currency = facts.currency;
  if (currency !== "USD" && currency !== "EUR" && currency !== "GBP")
    return undefined;
  if (
    typeof facts.totalMinor !== "string" ||
    !/^\d+$/.test(facts.totalMinor) ||
    typeof facts.partnerResaleTotalMinor !== "string" ||
    !/^\d+$/.test(facts.partnerResaleTotalMinor)
  )
    return undefined;
  return {
    transferPrice: formatMoney(facts.totalMinor, currency, formatting),
    resalePrice: formatMoney(
      facts.partnerResaleTotalMinor,
      currency,
      formatting,
    ),
  };
}

function partnerRecord(
  record: ProjectionRecord,
  surface: PartnerSurfaceKey,
  t: Translator,
  formatting: string,
): PartnerRecord {
  const data = record.data;
  const pricing =
    surface === "quotes" ? partnerQuotePricing(data, formatting) : undefined;
  // Facts, where the record carries them, are rendered for this reader. A
  // record that still carries pre-rendered strings shows them as written.
  const position = readPartnerPosition(data.position);
  const milestone = readPartnerMilestone(data.milestone);
  return {
    ...(pricing ? { quotePricing: pricing } : {}),
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
    value: position
      ? partnerPositionText(position, t, formatting)
      : text(data, "value"),
    secondary: milestone
      ? partnerMilestoneText(milestone, t, formatting)
      : text(data, "secondary"),
    ...(mountsPartnerDetail(surface)
      ? { href: partnerDetailRoute(surface, record.recordKey) }
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
  const t = await getTranslations();
  const formatting = formattingLocales[await getLocale()];
  return {
    ...page,
    records: page.records.map((record) =>
      partnerRecord(record, surface, t, formatting),
    ),
  };
}

export async function loadCustomerCollectionRecords(
  key: CustomerCollectionKey,
) {
  const page = await loadPortalRecords("customer", key);
  return {
    ...page,
    records: page.records.map(customerCollectionRecord),
  };
}
