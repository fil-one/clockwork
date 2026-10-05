import type { Metadata } from "next";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { ContractPageState } from "@/src/features/internal-ops/contracts/access-state";
import { loadRenewals } from "@/src/features/internal-ops/contracts/loaders";
import { RenewalsView } from "@/src/features/internal-ops/contracts/renewals-view";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.contracts.renewals.title") };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ window?: string | string[] }>;
}) {
  const { window } = await searchParams;
  const [t, locale, loaded] = await Promise.all([
    getTranslations(),
    getFormattingLocale(),
    loadRenewals(Array.isArray(window) ? window[0] : window),
  ]);
  if (loaded.kind !== "ready")
    return (
      <ContractPageState
        state={loaded}
        title={t("operations.contracts.renewals.title")}
      />
    );
  return (
    <RenewalsView
      t={t}
      locale={locale}
      days={loaded.days}
      rows={loaded.rows}
      today={loaded.today}
    />
  );
}
