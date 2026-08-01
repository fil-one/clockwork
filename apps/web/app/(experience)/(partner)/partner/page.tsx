import { PartnerDashboard } from "@/src/features/customer-partner/partner/partner-dashboard";
import { loadPartnerDashboardProjection } from "@/src/features/experience-server/dashboard-loader";
import { getRouteRoles } from "@/src/features/shell/route-session";

export default async function Page() {
  const roles = await getRouteRoles("partner");
  return (
    <PartnerDashboard
      projection={await loadPartnerDashboardProjection()}
      roles={roles}
    />
  );
}
