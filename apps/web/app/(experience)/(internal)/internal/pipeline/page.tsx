import type { Metadata } from "next";

import { loadPipelinePage } from "@/src/features/internal-ops/hubspot/page-data";
import { HubSpotPageState } from "@/src/features/internal-ops/hubspot/page-state";
import { PipelinePage } from "@/src/features/internal-ops/hubspot/pipeline";
import { withStaffPermission } from "@/src/features/shell/staff-access";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.hubspot.pipeline.title") };
}

/** HubSpot's pipeline, read-only, for the sales workspace: `sales:read`. */
async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, locale, loaded] = await Promise.all([
    getTranslations(),
    getFormattingLocale(),
    searchParams.then(loadPipelinePage),
  ]);
  if (loaded.kind !== "ready")
    return (
      <HubSpotPageState
        state={loaded}
        title={t("operations.hubspot.pipeline.title")}
      />
    );
  return (
    <PipelinePage
      t={t}
      locale={locale}
      query={loaded.query}
      view={loaded.view}
      selected={loaded.selected}
      people={loaded.people}
      portal={loaded.portal}
      demo={loaded.demo}
    />
  );
}

export default withStaffPermission("sales:read", Page);
