import { CustomerDashboard } from "@/src/features/customer-partner/customer/customer-dashboard";
import { getRouteRoles } from "@/src/features/shell/route-session";

export default async function Page() {
  const roles = await getRouteRoles("customer");
  const canCreateQuote = roles.some(
    (role) => role === "owner" || role === "admin",
  );
  return <CustomerDashboard canCreateQuote={canCreateQuote} />;
}
