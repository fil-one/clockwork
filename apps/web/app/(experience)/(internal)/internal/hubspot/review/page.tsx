import type { Metadata } from "next";

import { loadReview } from "@/src/features/internal-ops/hubspot/page-data";
import { HubSpotPageState } from "@/src/features/internal-ops/hubspot/page-state";
import { ReviewPage } from "@/src/features/internal-ops/hubspot/review-page";
import { withStaffPermission } from "@/src/features/shell/staff-access";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.hubspot.review.title") };
}

/**
 * The handoff review. Reading it needs `sales:read`; committing it is the
 * server action's own `contract:write` check.
 */
async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, loaded] = await Promise.all([
    getTranslations(),
    searchParams.then(loadReview),
  ]);
  if (loaded.kind !== "ready")
    return (
      <HubSpotPageState
        state={loaded}
        title={t("operations.hubspot.review.title")}
      />
    );
  return <ReviewPage t={t} loaded={loaded} />;
}

export default withStaffPermission("sales:read", Page);
