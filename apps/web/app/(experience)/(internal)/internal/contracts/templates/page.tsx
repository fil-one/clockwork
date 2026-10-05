import type { Metadata } from "next";
import { getTranslations } from "@/src/i18n/server";
import { ContractPageState } from "@/src/features/internal-ops/contracts/access-state";
import { loadTemplates } from "@/src/features/internal-ops/contracts/loaders";
import { TemplatePicker } from "@/src/features/internal-ops/contracts/template-picker";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.contracts.templates.title") };
}

export default async function Page() {
  const [t, loaded] = await Promise.all([getTranslations(), loadTemplates()]);
  if (loaded.kind !== "ready")
    return (
      <ContractPageState
        state={loaded}
        title={t("operations.contracts.templates.title")}
      />
    );
  return (
    <TemplatePicker
      t={t}
      templates={loaded.templates}
      canWrite={loaded.canWrite}
    />
  );
}
