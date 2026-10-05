import type { Metadata } from "next";

import { InternalProjectionPage } from "@/src/features/experience-server/internal-projection-page";
import { getTranslations } from "@/src/i18n/server";
import { withStaffPermission } from "@/src/features/shell/staff-access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("adminGovernance.approvals.page.title") };
}

async function Page() {
  const t = await getTranslations();
  return (
    <InternalProjectionPage
      channel="approvals"
      title={t("adminGovernance.approvals.page.title")}
      description={t("adminGovernance.approvals.page.description")}
    />
  );
}

export default withStaffPermission("operations:read", Page);
