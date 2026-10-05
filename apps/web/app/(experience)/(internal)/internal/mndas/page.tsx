import type { Metadata } from "next";
import { parseMndaRegisterParams } from "@clockwork/contracts";
import { getTranslations } from "@/src/i18n/server";
import { loadMndas } from "@/src/features/internal-ops/mnda/actions";
import { MndaAccessState } from "@/src/features/internal-ops/mnda/access-state";
import { MndaWorkspace } from "@/src/features/internal-ops/mnda/workspace";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.mnda.title") };
}
/** Filters live in the URL (`status`, `mine=1`, `q`, `page`) so other pages
 * can link to a filtered register. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseMndaRegisterParams(await searchParams);
  const result = await loadMndas(query);
  if (!result.ok) return <MndaAccessState code={result.code} />;
  return <MndaWorkspace initial={result.value} initialQuery={query} />;
}
