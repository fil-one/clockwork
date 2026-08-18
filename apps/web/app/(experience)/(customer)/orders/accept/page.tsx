import {
  OrderAcceptance,
  type GoverningAgreement,
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

import { selectAcceptanceQuote, toAcceptableQuote } from "./select-quote";

type Data = Readonly<Record<string, unknown>>;

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
 * Why this page reads no orders channel any more.
 *
 * Acceptance binds the rendered order form, and a first pass asks the server
 * to render it. The page used to look for the resulting document on the orders
 * projection. It cannot be there: `orders:prepare_artifact` writes no order
 * row, `mutateOrder`'s create branch is the only writer of `public.orders` and
 * of `orders.order_form_document_id`, and the orders channel projects
 * `public.orders`. The one value that channel could ever match on -- an
 * `orderFormDocumentId` beside this page's `quoteId` -- therefore belongs to an
 * order that has *already* been created, bound to a different order identifier
 * and to entries this reader never typed. Handing that to the create pass is
 * `COMMERCIAL_ARTIFACT_BINDING_INVALID`; waiting for anything else here is
 * waiting for ever.
 *
 * The binding between the two passes lives on the artifact request. The
 * prepare response returns that request's identifier, and the client polls its
 * authorization-scoped, bodyless artifact representation GET; no server render
 * can answer the question in advance.
 */
async function OrderAcceptanceWorkspace({
  params,
}: {
  params: RawSearchParams;
}) {
  const requested = firstSearchParam(params, "quote");
  const [identity, quotes, agreements] = await Promise.all([
    getRouteIdentity("customer"),
    loadPortalRecords("customer", "quotes"),
    loadGoverningAgreement(),
  ]);
  // An explicit quote key is a binding, not a hint. Falling back to the first
  // acceptable quote when that key has not projected yet can make a reader
  // attest to a different commercial record than the one their prior step
  // issued. With no explicit key the existing newest-acceptable behavior
  // remains available for ordinary entry from the navigation.
  const selected = selectAcceptanceQuote(quotes.records, requested);
  const quote = selected ? toAcceptableQuote(selected) : null;
  return (
    <OrderAcceptance
      account={{ id: identity.accountId, name: identity.accountName }}
      agreement={governingAgreement(agreements.records)}
      // A truncated read is a prefix, not the set: the quote this page
      // selected and the agreement it bound may both be wrong, and the reader
      // is the one committing money on them.
      partialRead={quotes.truncated || agreements.truncated}
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
