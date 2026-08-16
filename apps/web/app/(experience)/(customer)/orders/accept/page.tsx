import {
  OrderAcceptance,
  type AcceptableQuote,
  type GoverningAgreement,
  type PreparedOrderForm,
} from "@/src/features/customer-partner/commercial/order-acceptance";
import {
  firstSearchParam,
  type RawSearchParams,
} from "@/src/features/customer-partner/commercial/url-state";
import type { ProjectionRecord } from "@/src/features/experience-server/model";
import {
  loadPortalRecords,
  loadTopPortalRecords,
  type PortalRecords,
} from "@/src/features/experience-server/portal-view-loader";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteIdentity } from "@/src/features/shell/route-session";

type Data = Readonly<Record<string, unknown>>;

const acceptableStatuses = ["issued", "accepted", "open"];

/**
 * How many agreements the governing-agreement probe asks for.
 *
 * The probe is a real server-side top-N -- `order by source_updated_at desc
 * limit N` -- not a slice of a full read. It is only conclusive when it
 * answers the question, so a probe that finds no active agreement while more
 * pages exist still falls back to the full read; the value on screen is
 * therefore identical to the one the full read produced, at one request
 * instead of up to a hundred whenever a recently touched active agreement
 * exists.
 */
const AGREEMENT_PROBE_LIMIT = 25;

function text(data: Data, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Server-projected records carry the raw aggregate under `authoritative`. */
function authoritative(data: Data): Data {
  const value = data.authoritative;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Data)
    : {};
}

function acceptableQuote(record: ProjectionRecord): AcceptableQuote {
  const data = record.data;
  return {
    id: record.aggregateId,
    reference: record.recordKey,
    title: text(data, "title") ?? record.recordKey,
    version: text(data, "version") ?? String(record.version),
    scope: text(data, "description") ?? "Scope not recorded",
    spend: text(data, "value") ?? "Not priced",
    acceptedLabel: text(data, "dateLabel") ?? "Acceptance date not recorded",
  };
}

function activeAgreement(
  records: readonly ProjectionRecord[],
): ProjectionRecord | undefined {
  return records.find((record) => text(record.data, "status") === "active");
}

function governingAgreement(
  records: readonly ProjectionRecord[],
): GoverningAgreement | null {
  const active = activeAgreement(records) ?? records[0];
  if (!active) return null;
  return {
    title: text(active.data, "title") ?? active.recordKey,
    version: text(active.data, "version") ?? String(active.version),
  };
}

/**
 * The surface needs one agreement, so it asks the server for the newest few
 * rather than every page of the channel.
 *
 * The escalation is the honest part: a prefix cannot prove the *absence* of an
 * active agreement, so when the probe finds none and the channel held more,
 * the full read still happens. Facet and workspace surfaces must keep reading
 * everything; this one never builds a facet.
 */
async function loadGoverningAgreement(): Promise<
  PortalRecords<ProjectionRecord>
> {
  const probe = await loadTopPortalRecords("customer", "agreements", {
    limit: AGREEMENT_PROBE_LIMIT,
    orderBy: "updated_desc",
  });
  if (activeAgreement(probe.records) || !probe.truncated) return probe;
  return loadPortalRecords("customer", "agreements");
}

/**
 * Acceptance binds the rendered order form. A first pass asks the server to
 * render it; the document identifier only exists on the order projection once
 * that request has been fulfilled.
 *
 * The order the document belongs to travels with it. The server binds the two
 * -- `assertCommercialArtifactBinding` matches on `(document_id, subject_type,
 * subject_id)` -- and a create pass naming any other order is refused, so a
 * surface that hands the client a bare document identifier is handing it
 * something it cannot safely use.
 */
function preparedOrderForm(
  records: readonly ProjectionRecord[],
  quoteId: string,
): PreparedOrderForm | null {
  for (const record of records) {
    const state = authoritative(record.data);
    if (text(state, "quoteId") !== quoteId) continue;
    const documentId = text(state, "orderFormDocumentId");
    if (documentId)
      return { documentId, orderId: text(state, "id") ?? record.aggregateId };
  }
  return null;
}

async function OrderAcceptanceWorkspace({
  params,
}: {
  params: RawSearchParams;
}) {
  const requested = firstSearchParam(params, "quote");
  const [identity, quotes, agreements, orders] = await Promise.all([
    getRouteIdentity("customer"),
    loadPortalRecords("customer", "quotes"),
    loadGoverningAgreement(),
    loadPortalRecords("customer", "orders"),
  ]);
  const selected =
    (requested
      ? quotes.records.find((record) => record.recordKey === requested)
      : undefined) ??
    quotes.records.find((record) =>
      acceptableStatuses.includes(text(record.data, "status") ?? ""),
    );
  const quote = selected ? acceptableQuote(selected) : null;
  return (
    <OrderAcceptance
      account={{ id: identity.accountId, name: identity.accountName }}
      agreement={governingAgreement(agreements.records)}
      orderForm={quote ? preparedOrderForm(orders.records, quote.id) : null}
      // A truncated read is a prefix, not the set: the quote this page
      // selected and the agreement it bound may both be wrong, and the reader
      // is the one committing money on them.
      partialRead={quotes.truncated || agreements.truncated || orders.truncated}
      quote={quote}
      signerUserId={identity.userId}
    />
  );
}

/**
 * No `Suspense` element is added here, and that is deliberate.
 *
 * `app/(experience)/(customer)/orders/loading.tsx` already declares a boundary
 * at the `orders` segment, and Next applies a segment's `loading.tsx` to its
 * nested routes, so this page's three channel reads already stream *below*
 * `(customer)/layout.tsx` -- navigation, banner and command palette are
 * flushed before the reads start. Nesting a second boundary inside the page
 * would only replace one fallback with another mid-stream.
 *
 * The routes that genuinely wait on their reads are the customer segments with
 * no nearer `loading.tsx` -- `dashboard`, `account`, `amendments`,
 * `marketplace`, `support` -- which fall back to `(experience)/loading.tsx`.
 * That file sits *above* `(customer)/layout.tsx`, so their shell is inside the
 * fallback. One `app/(experience)/(customer)/loading.tsx` fixes all of them,
 * the way `partner/loading.tsx` and `internal/loading.tsx` already do for the
 * other two audiences.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="order:write">
      <OrderAcceptanceWorkspace params={params} />
    </SurfacePermissionGate>
  );
}
