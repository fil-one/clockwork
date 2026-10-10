import type { Metadata } from "next";
import { explicitDemoIdentityEnabled } from "@/src/auth/session";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { ContractPageState } from "@/src/features/internal-ops/contracts/access-state";
import { loadRegister } from "@/src/features/internal-ops/contracts/loaders";
import { RegisterView } from "@/src/features/internal-ops/contracts/register-view";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.contracts.title") };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, locale, loaded] = await Promise.all([
    getTranslations(),
    getFormattingLocale(),
    searchParams.then(loadRegister),
  ]);
  if (loaded.kind !== "ready")
    return (
      <ContractPageState
        state={loaded}
        title={t("operations.contracts.title")}
      />
    );
  return (
    <RegisterView
      t={t}
      locale={locale}
      query={loaded.query}
      result={loaded.result}
      today={loaded.today}
      canWrite={loaded.canWrite}
      canOpenMndas={loaded.canOpenMndas}
      demo={explicitDemoIdentityEnabled()}
    />
  );
}
