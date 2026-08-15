import { PartnerDashboard } from "@/src/features/customer-partner/partner/partner-dashboard";
import { loadPartnerDashboardProjection } from "@/src/features/experience-server/dashboard-loader";
import { getRouteSession } from "@/src/features/shell/route-session";

export default async function Page() {
  const session = await getRouteSession("partner");
  return (
    <PartnerDashboard
      formatting={{ locale: session.locale, timeZone: session.timeZone }}
      projection={await loadPartnerDashboardProjection()}
      roles={session.roles}
    />
  );
}
