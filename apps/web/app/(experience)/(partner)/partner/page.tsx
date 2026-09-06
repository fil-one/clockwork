import { PartnerDashboard } from "@/src/features/customer-partner/partner/partner-dashboard";
import { loadPartnerDashboardProjection } from "@/src/features/experience-server/dashboard-loader";
import {
  getRouteIdentity,
  getRouteSession,
} from "@/src/features/shell/route-session";

export default async function Page() {
  const [session, identity] = await Promise.all([
    getRouteSession("partner"),
    getRouteIdentity("partner"),
  ]);
  return (
    <PartnerDashboard
      formatting={{ locale: session.locale, timeZone: session.timeZone }}
      projection={await loadPartnerDashboardProjection(identity)}
      roles={session.roles}
    />
  );
}
