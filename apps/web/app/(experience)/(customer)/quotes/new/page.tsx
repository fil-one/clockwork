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
  const [identity, origin, offerResult] = await Promise.all([
    getRouteIdentity("customer"),
    resolveOrigin(
      firstSearchParam(params, "revises"),
      firstSearchParam(params, "poc"),
    ),
    loadCustomerQuoteOffers(),
  ]);
  return (
    <QuoteBuilder
      account={{ id: identity.accountId, name: identity.accountName }}
      catalogueMode={
        offerResult.status === "available"
          ? offerResult.catalogueMode
          : "authoritative"
      }
      initialDraft={parseQuotePrefill(params)}
      offers={offerResult.status === "available" ? offerResult.offers : []}
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
