import {
  QuoteBuilder,
  type QuoteOrigin,
} from "@/src/features/customer-partner/commercial/quote-builder";
import {
  firstSearchParam,
  parseQuotePrefill,
  type RawSearchParams,
} from "@/src/features/customer-partner/commercial/url-state";
import {
  loadCustomerQuoteOffers,
  loadPortalRecords,
} from "@/src/features/experience-server/portal-view-loader";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteIdentity } from "@/src/features/shell/route-session";

async function resolveOrigin(
  revises: string | undefined,
  poc: string | undefined,
): Promise<QuoteOrigin | undefined> {
  if (revises) {
    const { records } = await loadPortalRecords("customer", "quotes");
    return {
      kind: "revision",
      reference: revises,
      resolved: records.some((record) => record.recordKey === revises),
    };
  }
  if (poc) {
    const { records } = await loadPortalRecords("customer", "pocs");
    return {
      kind: "poc",
      reference: poc,
      resolved: records.some((record) => record.recordKey === poc),
    };
  }
  return undefined;
}

async function QuoteWorkspace({ params }: { params: RawSearchParams }) {
  const [identity, originalOrigin, offerResult] = await Promise.all([
    getRouteIdentity("customer"),
    resolveOrigin(
      firstSearchParam(params, "revises"),
      firstSearchParam(params, "poc"),
    ),
    loadCustomerQuoteOffers(),
  ]);
  let origin = originalOrigin;
  let initialDraft: Parameters<typeof QuoteBuilder>[0]["initialDraft"] =
    parseQuotePrefill(params);
  let offers = offerResult.status === "available" ? offerResult.offers : [];
  if (origin?.kind === "revision") {
    const { records } = await loadPortalRecords("customer", "quotes");
    const prior = records.find(
      (record) => record.recordKey === origin?.reference,
    );
    const source = prior?.data.authoritative as
      | {
          seriesId?: string;
          priceBookId?: string;
          status?: string;
          lines?: {
            sku: string;
            region: string;
            quantity: string;
            termMonths: number;
          }[];
        }
      | undefined;
    const line = source?.lines?.length === 1 ? source.lines[0] : undefined;
    const offer = offers.find(
      (candidate) =>
        candidate.priceBookId === source?.priceBookId &&
        candidate.sku === line?.sku &&
        candidate.region === line?.region,
    );
    if (
      prior &&
      source?.seriesId &&
      source.priceBookId &&
      line &&
      offer &&
      ["issued", "expired", "rejected"].includes(source.status ?? "")
    ) {
      origin = {
        ...origin,
        revision: {
          quoteId: prior.aggregateId,
          version: prior.version,
          seriesId: source.seriesId,
          priceBookId: source.priceBookId,
        },
      };
      offers = offers.filter(
        (candidate) => candidate.priceBookId === source.priceBookId,
      );
      initialDraft = {
        capacity: line.quantity,
        termMonths: String(line.termMonths),
        offer: offer.label,
        region: line.region,
      };
    } else origin = { ...origin, resolved: false };
  }
  return (
    <QuoteBuilder
      account={{ id: identity.accountId, name: identity.accountName }}
      catalogueMode={
        offerResult.status === "available"
          ? offerResult.catalogueMode
          : "authoritative"
      }
      initialDraft={initialDraft}
      offers={offers}
      {...(origin ? { origin } : {})}
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
    <SurfacePermissionGate audience="customer" requiredPermission="quote:write">
      <QuoteWorkspace params={params} />
    </SurfacePermissionGate>
  );
}
