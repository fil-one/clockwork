import type { Metadata } from "next";
import { PageHeader } from "@clockwork/ui";
import { getTranslations } from "@/src/i18n/server";
import { ContractPageState } from "@/src/features/internal-ops/contracts/access-state";
import { TemplateBreadcrumbs } from "@/src/features/internal-ops/contract-templates/admin-list";
import { loadTemplateVersion } from "@/src/features/internal-ops/contract-templates/loaders";
import { VersionView } from "@/src/features/internal-ops/contract-templates/version-view";
import styles from "@/src/features/internal-ops/contract-templates/templates.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.contractTemplates.title") };
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, t] = await Promise.all([params, getTranslations()]);
  const loaded = await loadTemplateVersion(id);
  if (loaded.kind !== "ready")
    return (
      <ContractPageState
        state={loaded}
        title={t("operations.contractTemplates.title")}
      />
    );
  const { record } = loaded;
  return (
    <main className={styles.page} id="main-content">
      <TemplateBreadcrumbs
        t={t}
        current={`${record.name} ${record.versionLabel}`}
      />
      <PageHeader
        eyebrow={t("operations.contractTemplates.title")}
        title={record.name}
        description={t("operations.contractTemplates.versionDescription")}
      />
      {/* Keyed by revision so a refresh after a status change starts fresh. */}
      <VersionView
        key={`${record.id}-${record.revision}`}
        record={record}
        others={loaded.others}
        demo={loaded.demo}
      />
    </main>
  );
}
