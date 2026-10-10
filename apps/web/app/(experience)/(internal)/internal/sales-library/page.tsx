import type { Metadata } from "next";
import { contractToday } from "@clockwork/domain/contract-terms";
import { explicitDemoIdentityEnabled } from "@/src/auth/session";
import { getTranslations } from "@/src/i18n/server";
import { ContractPageState } from "@/src/features/internal-ops/contracts/access-state";
import { loadWith } from "@/src/features/internal-ops/contracts/loaders";
import { salesLibraryReader } from "@/src/features/internal-ops/contracts/demo-access";
import { sessionHas } from "@/src/features/internal-ops/contracts/server";
import { SalesLibraryView } from "@/src/features/internal-ops/sales-library/library-view";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.salesLibrary.title") };
}

export default async function Page() {
  const [t, loaded] = await Promise.all([
    getTranslations(),
    loadWith("sales:read", async (session) => ({
      items: await salesLibraryReader().list(),
      canManage: sessionHas(session, "collateral:manage"),
    })),
  ]);
  if (loaded.kind !== "ready")
    return (
      <ContractPageState
        state={loaded}
        area="salesLibrary"
        title={t("operations.salesLibrary.title")}
      />
    );
  return (
    <SalesLibraryView
      items={loaded.items}
      canManage={loaded.canManage}
      today={contractToday()}
      demo={explicitDemoIdentityEnabled()}
    />
  );
}
