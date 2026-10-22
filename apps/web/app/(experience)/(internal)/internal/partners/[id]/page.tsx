import { AccountDocumentsSection } from "@/src/features/internal-ops/account-documents/section";
import type { Metadata } from "next";
import { cache } from "react";

import { loadPartnerHubSpotParts } from "@/src/features/internal-ops/hubspot/page-data";
import { PartnerHubSpotSection } from "@/src/features/internal-ops/hubspot/partner-section";
import { HubSpotReceipt } from "@/src/features/internal-ops/hubspot/receipt";
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

async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
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
  const hubspot = await loadPartnerHubSpotParts(loaded.partner, query);
  return (
    <PartnerDetail
      t={t}
      locale={locale}
      documents={
        <AccountDocumentsSection
          target={{ type: "partner", id: loaded.partner.id }}
        />
      }
      hubspot={
        <PartnerHubSpotSection
          t={t}
          locale={locale}
          partnerId={loaded.partner.id}
          view={hubspot.view}
          canEdit={loaded.canEdit}
        />
      }
      receipt={
        hubspot.receipt ? (
          <HubSpotReceipt
            record={hubspot.receipt}
            canEdit={loaded.canEdit}
            autoStart={hubspot.autoStart}
            focus
          />
        ) : null
      }
      dealSuggestion={loaded.canEdit ? hubspot.dealSuggestion : null}
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
