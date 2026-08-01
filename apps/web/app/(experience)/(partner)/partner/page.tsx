import { PartnerDashboard } from "@/src/features/customer-partner/partner/partner-dashboard";
import { getRouteRoles } from "@/src/features/shell/route-session";

export default async function Page() {
  const roles = await getRouteRoles("partner");
  return <PartnerDashboard roles={roles} />;
}
