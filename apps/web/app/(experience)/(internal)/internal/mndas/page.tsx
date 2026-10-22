import type { Metadata } from "next";
import { parseMndaRegisterParams } from "@clockwork/contracts";
import { getTranslations } from "@/src/i18n/server";
import { loadMndaPage } from "@/src/features/internal-ops/mnda/page-data";
import { MndaAccessState } from "@/src/features/internal-ops/mnda/access-state";
import { MndaWorkspace } from "@/src/features/internal-ops/mnda/workspace";
import { loadMndaPrefill } from "@/src/features/internal-ops/hubspot/page-data";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.mnda.title") };
}
/** Filters live in the URL (`status`, `mine=1`, `q`, `page`) so other pages
 * can link to a filtered register; `compose=1` opens a new MNDA. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = parseMndaRegisterParams(params);
  const result = await loadMndaPage(query);
  if (!result.ok) return <MndaAccessState code={result.code} />;
  const compose = params.compose === "1";
  // `handoff` names a HubSpot import whose company and chosen contact are
  // offered as suggestions; the page has already checked MNDA access.
  const prefill = compose
    ? await loadMndaPrefill(params.partner, params.handoff)
    : null;
  return (
    <MndaWorkspace
      initial={result.value}
      initialQuery={query}
      compose={compose}
      prefill={prefill}
    />
  );
}
