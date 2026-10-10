import type { Metadata } from "next";
import { getTranslations } from "@/src/i18n/server";
import { loadMndaSettingsPage } from "@/src/features/internal-ops/mnda/page-data";
import { MndaAccessState } from "@/src/features/internal-ops/mnda/access-state";
import { MndaSettingsWorkspace } from "@/src/features/internal-ops/mnda/settings-workspace";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.mnda.settings.title") };
}
export default async function Page() {
  const result = await loadMndaSettingsPage();
  if (!result.ok) return <MndaAccessState code={result.code} />;
  return <MndaSettingsWorkspace initial={result.value} />;
}
