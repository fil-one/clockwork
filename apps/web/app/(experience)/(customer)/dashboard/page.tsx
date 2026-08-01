import { CustomerDashboard } from "@/src/features/customer-partner/customer/customer-dashboard";
import { loadCustomerDashboardProjection } from "@/src/features/experience-server/dashboard-loader";
import { getRouteRoles } from "@/src/features/shell/route-session";

export default async function Page() {
  const roles = await getRouteRoles("customer");
  const canCreateQuote = roles.some(
    (role) => role === "owner" || role === "admin",
  );
  return (
    <CustomerDashboard
      canCreateQuote={canCreateQuote}
      projection={await loadCustomerDashboardProjection()}
    />
  );
}
