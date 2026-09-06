import { loadChannelPolicy } from "@/src/features/experience-server/channel-policy-loader";
import { explicitDemoIdentityEnabled } from "@/src/auth/session";
import { SelfServeBuy } from "@/src/features/customer-partner/commercial/buy";
import { loadCustomerQuoteOffers } from "@/src/features/experience-server/portal-view-loader";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteIdentity } from "@/src/features/shell/route-session";

export const dynamic = "force-dynamic";

async function BuyWorkspace() {
  const [identity, offerResult, channelPolicy] = await Promise.all([
    getRouteIdentity("customer"),
    loadCustomerQuoteOffers(),
    loadChannelPolicy(),
  ]);
  if (!channelPolicy)
    return (
      <p role="status">
        The acquisition policy is unavailable. Try again before starting a
        quote.
      </p>
    );
  const mode = explicitDemoIdentityEnabled() ? "demo" : "authoritative";
  return (
    <SelfServeBuy
      thresholdTb={channelPolicy.selfServeThresholdTb}
      account={{ id: identity.accountId, name: identity.accountName }}
      catalogueMode={
        offerResult.status === "available"
          ? offerResult.catalogueMode
          : "authoritative"
      }
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
