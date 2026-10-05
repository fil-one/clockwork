import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getTranslations } from "@/src/i18n/server";
import { SalesHome } from "@/src/features/internal-ops/sales-home/sales-home";
import { loadSalesHome } from "@/src/features/internal-ops/sales-home/server-loader";
import {
  getRouteIdentity,
  getRouteSession,
} from "@/src/features/shell/route-session";
import {
  StaffRoleNotAvailable,
  staffMayUse,
} from "@/src/features/shell/staff-access";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.sales.home.title") };
}

/**
 * The staff landing page. Anyone with the sales workspace starts on their own
 * work; a staff member with operations alone starts on the operations board.
 */
export default async function Page() {
  const session = await getRouteSession("internal");
  if (!staffMayUse(session.roles, "sales:read")) {
    if (staffMayUse(session.roles, "operations:read"))
      redirect("/internal/operations");
    return <StaffRoleNotAvailable roles={session.roles} />;
  }
  const identity = await getRouteIdentity("internal");
  const sections = await loadSalesHome({
    userId: identity.userId,
    roles: session.roles,
    providerBacked: session.providerBacked,
    now: new Date(),
  });
  return (
    <SalesHome
      userId={identity.userId}
      sections={sections}
      canSendMnda={
        session.providerBacked && staffMayUse(session.roles, "mnda:send")
      }
    />
  );
}
