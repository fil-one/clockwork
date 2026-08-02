import {
  OrderAcceptance,
  type AcceptableQuote,
  type GoverningAgreement,
} from "@/src/features/customer-partner/commercial/order-acceptance";
import {
  firstSearchParam,
  type RawSearchParams,
} from "@/src/features/customer-partner/commercial/url-state";
import type { ProjectionRecord } from "@/src/features/experience-server/model";
import { loadPortalRecords } from "@/src/features/experience-server/portal-view-loader";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteIdentity } from "@/src/features/shell/route-session";

type Data = Readonly<Record<string, unknown>>;

const acceptableStatuses = ["issued", "accepted", "open"];

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

function governingAgreement(
  records: readonly ProjectionRecord[],
): GoverningAgreement | null {
  const active =
    records.find((record) => text(record.data, "status") === "active") ??
    records[0];
  if (!active) return null;
  return {
    title: text(active.data, "title") ?? active.recordKey,
    version: text(active.data, "version") ?? String(active.version),
  };
}

/**
 * Acceptance binds the rendered order form. A first pass asks the server to
 * render it; the document identifier only exists on the order projection once
 * that request has been fulfilled.
 */
function preparedOrderForm(
  records: readonly ProjectionRecord[],
  quoteId: string,
): string | null {
  for (const record of records) {
    const state = authoritative(record.data);
    if (text(state, "quoteId") !== quoteId) continue;
    const documentId = text(state, "orderFormDocumentId");
    if (documentId) return documentId;
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
    loadPortalRecords("customer", "agreements"),
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
      orderFormDocumentId={
        quote ? preparedOrderForm(orders.records, quote.id) : null
      }
      quote={quote}
      signerUserId={identity.userId}
    />
  );
}

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
