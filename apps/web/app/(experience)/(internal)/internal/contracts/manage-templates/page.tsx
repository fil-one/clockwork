import type { Metadata } from "next";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { ContractPageState } from "@/src/features/internal-ops/contracts/access-state";
import { TemplateAdminList } from "@/src/features/internal-ops/contract-templates/admin-list";
import { loadTemplateAdmin } from "@/src/features/internal-ops/contract-templates/loaders";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.contractTemplates.title") };
}

export default async function Page() {
  const [t, locale, loaded] = await Promise.all([
    getTranslations(),
    getFormattingLocale(),
    loadTemplateAdmin(),
  ]);
  if (loaded.kind !== "ready")
    return (
      <ContractPageState
        state={loaded}
        title={t("operations.contractTemplates.title")}
      />
    );
  return (
    <TemplateAdminList
      t={t}
      locale={locale}
      groups={loaded.groups}
      demo={loaded.demo}
    />
  );
}
