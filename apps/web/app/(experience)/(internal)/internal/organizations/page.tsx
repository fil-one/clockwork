import type { Metadata } from "next";

import { OrganizationList } from "@/src/features/internal-ops/organizations/organization-views";
import { loadOrganizations } from "@/src/features/internal-ops/organizations/server";
import { getRouteSession } from "@/src/features/shell/route-session";
import {
  staffMayUse,
  withStaffPermission,
} from "@/src/features/shell/staff-access";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.organizations.title") };
}

async function Page() {
  const [session, loaded] = await Promise.all([
    getRouteSession("internal"),
    loadOrganizations(),
  ]);
  return (
    <OrganizationList
      organizations={loaded.kind === "ready" ? loaded.value : null}
      canWrite={staffMayUse(session, "operations:write")}
    />
  );
}

export default withStaffPermission("operations:read", Page);
