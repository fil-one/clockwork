import { PartnerEnablement } from "@/src/features/customer-partner/partner/enablement";
import {
  NoPartnerMembership,
  partnerRouteMembership,
} from "@/src/features/customer-partner/partner/partner-membership";
import { getRouteSession } from "@/src/features/shell/route-session";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getRouteSession("partner");
  const membership = partnerRouteMembership(session);
  if (!membership) return <NoPartnerMembership />;
  return (
    <PartnerEnablement
      roles={session.roles}
      partnerName={membership.accountName}
    />
  );
}
