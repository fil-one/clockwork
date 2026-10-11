import type { Metadata } from "next";
import { PageHeader } from "@clockwork/ui";
import { getTranslations } from "@/src/i18n/server";
import { ContractPageState } from "@/src/features/internal-ops/contracts/access-state";
import { TemplateBreadcrumbs } from "@/src/features/internal-ops/contract-templates/admin-list";
import { loadTemplateAdmin } from "@/src/features/internal-ops/contract-templates/loaders";
import { NewTemplate } from "@/src/features/internal-ops/contract-templates/new-template";
import styles from "@/src/features/internal-ops/contract-templates/templates.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.contractTemplates.new") };
}

export default async function Page() {
  const [t, loaded] = await Promise.all([
    getTranslations(),
    loadTemplateAdmin(),
  ]);
  if (loaded.kind !== "ready")
    return (
      <ContractPageState
        state={loaded}
        title={t("operations.contractTemplates.new")}
      />
    );
  return (
    <main className={styles.page} id="main-content">
      <TemplateBreadcrumbs
        t={t}
        current={t("operations.contractTemplates.new")}
      />
      <PageHeader
        title={t("operations.contractTemplates.new")}
        description={t("operations.contractTemplates.newDescription")}
      />
      <NewTemplate demo={loaded.demo} />
    </main>
  );
}
