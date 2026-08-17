import { explicitDemoIdentityEnabled } from "@/src/auth/session";
import { SelfServeBuy } from "@/src/features/customer-partner/commercial/buy";
import { loadCustomerQuoteOffers } from "@/src/features/experience-server/portal-view-loader";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteIdentity } from "@/src/features/shell/route-session";

import {
  lookupBuyQuoteProjection,
  lookupPreparedQuoteArtifact,
} from "./actions";

export const dynamic = "force-dynamic";

async function BuyWorkspace() {
  const [identity, offerResult] = await Promise.all([
    getRouteIdentity("customer"),
    loadCustomerQuoteOffers(),
  ]);
  const mode = explicitDemoIdentityEnabled() ? "demo" : "authoritative";
  return (
    <SelfServeBuy
      account={{ id: identity.accountId, name: identity.accountName }}
      catalogueMode={
        offerResult.status === "available"
          ? offerResult.catalogueMode
          : "authoritative"
      }
      lookupArtifact={lookupPreparedQuoteArtifact}
      lookupProjection={lookupBuyQuoteProjection}
      mode={mode}
      offers={offerResult.status === "available" ? offerResult.offers : []}
    />
  );
}

export default function Page() {
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="quote:write">
      <BuyWorkspace />
    </SurfacePermissionGate>
  );
}
