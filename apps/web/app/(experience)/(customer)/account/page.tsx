import { AccountOverview } from "@/src/features/customer-partner/customer/account-overview";
import { getRouteRoles } from "@/src/features/shell/route-session";

export default async function Page() {
  const roles = await getRouteRoles("customer");
  const canManageAccount = roles.some(
    (role) => role === "owner" || role === "admin",
  );
  return <AccountOverview canManageAccount={canManageAccount} />;
}
