import type { Metadata } from "next";

import { InternalProjectionPage } from "@/src/features/experience-server/internal-projection-page";
import { getTranslations } from "@/src/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("adminGovernance.approvals.page.title") };
}

export default async function Page() {
  const t = await getTranslations();
  return (
    <InternalProjectionPage
      channel="approvals"
      title={t("adminGovernance.approvals.page.title")}
      description={t("adminGovernance.approvals.page.description")}
    />
  );
}
