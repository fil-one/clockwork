import { getTranslations } from "@/src/i18n/server";
import { loadMndas } from "@/src/features/internal-ops/mnda/actions";
import { MndaWorkspace } from "@/src/features/internal-ops/mnda/workspace";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const t = await getTranslations();
  // i18n-exempt: product name suffix; page title is translated
  return { title: `${t("operations.mnda.title")} | Fil One Commerce` };
}
export default async function Page() {
  return <MndaWorkspace initial={await loadMndas()} />;
}
