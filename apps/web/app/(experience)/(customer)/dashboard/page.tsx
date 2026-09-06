import { CustomerDashboard } from "@/src/features/customer-partner/customer/customer-dashboard";
import { loadCustomerDashboardProjection } from "@/src/features/experience-server/dashboard-loader";
import {
  getRouteSession,
  getRouteIdentity,
} from "@/src/features/shell/route-session";

export default async function Page() {
  const [session, identity] = await Promise.all([
    getRouteSession("customer"),
    getRouteIdentity("customer"),
  ]);
  const canCreateQuote = session.roles.some(
    (role) => role === "owner" || role === "admin",
  );
  return (
    <CustomerDashboard
      canCreateQuote={canCreateQuote}
      formatting={{ locale: session.locale, timeZone: session.timeZone }}
      greetingName={
        session.profile.name.split(/\s+/)[0] ?? session.profile.name
      }
      projection={await loadCustomerDashboardProjection(identity.accountName)}
    />
  );
}
