import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { handoffHref } from "@/src/features/internal-ops/hubspot/model";
import { loadPicker } from "@/src/features/internal-ops/hubspot/page-data";
import { HubSpotPageState } from "@/src/features/internal-ops/hubspot/page-state";
import { HubSpotPicker } from "@/src/features/internal-ops/hubspot/picker";
import { withStaffPermission } from "@/src/features/shell/staff-access";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.hubspot.picker.title") };
}

/** Choose a HubSpot company or deal to bring in: `sales:read`. */
async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, loaded] = await Promise.all([
    getTranslations(),
    searchParams.then(loadPicker),
  ]);
  if (loaded.kind !== "ready")
    return (
      <HubSpotPageState
        state={loaded}
        title={t("operations.hubspot.picker.title")}
      />
    );
  // A pasted record link opens its review directly.
  if (loaded.result.kind === "record")
    redirect(
      loaded.result.objectType === "company"
        ? handoffHref({
            company: loaded.result.objectId,
            deal: loaded.deal,
            partner: loaded.partner,
          })
        : handoffHref({
            deal: loaded.result.objectId,
            partner: loaded.partner,
          }),
    );
  return (
    <HubSpotPicker
      t={t}
      q={loaded.q}
      deal={loaded.deal}
      partner={loaded.partner}
      result={loaded.result}
      portalId={loaded.portalId}
      canImport={loaded.canImport}
      demo={loaded.demo}
    />
  );
}

export default withStaffPermission("sales:read", Page);
