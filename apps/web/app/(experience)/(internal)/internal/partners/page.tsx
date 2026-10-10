import type { Metadata } from "next";

import { PartnerList } from "@/src/features/internal-ops/partners/partner-list";
import { PartnerPageState } from "@/src/features/internal-ops/partners/page-state";
import { loadPartnerList } from "@/src/features/internal-ops/partners/server";
import { withStaffPermission } from "@/src/features/shell/staff-access";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.partners.title") };
}

/** Partner records for the sales workspace: read with `sales:read`. */
async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, locale, loaded] = await Promise.all([
    getTranslations(),
    getFormattingLocale(),
    searchParams.then(loadPartnerList),
  ]);
  if (loaded.kind !== "ready")
    return (
      <PartnerPageState state={loaded} title={t("operations.partners.title")} />
    );
  return (
    <PartnerList
      t={t}
      locale={locale}
      query={loaded.query}
      result={loaded.result}
      owners={loaded.owners}
      today={loaded.today}
      canEdit={loaded.canEdit}
      demo={loaded.demo}
    />
  );
}

export default withStaffPermission("sales:read", Page);
