import type { Metadata } from "next";
import { cache } from "react";

import { PartnerDetail } from "@/src/features/internal-ops/partners/partner-detail";
import { PartnerPageState } from "@/src/features/internal-ops/partners/page-state";
import { loadPartner } from "@/src/features/internal-ops/partners/server";
import { withStaffPermission } from "@/src/features/shell/staff-access";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

/** One read per request, shared by the document title and the page. */
const load = cache((id: string) => loadPartner(id));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const [t, { id }] = await Promise.all([getTranslations(), params]);
  const loaded = await load(id);
  return {
    title:
      loaded.kind === "ready"
        ? loaded.partner.name
        : t("operations.partners.detail.title"),
  };
}

async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, locale, loaded] = await Promise.all([
    getTranslations(),
    getFormattingLocale(),
    load(id),
  ]);
  if (loaded.kind !== "ready")
    return (
      <PartnerPageState
        state={loaded}
        title={t("operations.partners.detail.title")}
      />
    );
  return (
    <PartnerDetail
      t={t}
      locale={locale}
      partner={loaded.partner}
      deals={loaded.deals}
      activity={loaded.activity}
      links={loaded.links}
      today={loaded.today}
      protectionDays={loaded.protectionDays}
      organizations={loaded.organizations}
      canEdit={loaded.canEdit}
      demo={loaded.demo}
    />
  );
}

export default withStaffPermission("sales:read", Page);
