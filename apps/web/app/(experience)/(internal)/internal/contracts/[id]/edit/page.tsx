import type { Metadata } from "next";
import { PageHeader } from "@clockwork/ui";
import { getTranslations } from "@/src/i18n/server";
import { ContractPageState } from "@/src/features/internal-ops/contracts/access-state";
import { ContractForm } from "@/src/features/internal-ops/contracts/contract-form";
import { loadContractForm } from "@/src/features/internal-ops/contracts/loaders";
import styles from "@/src/features/internal-ops/contracts/contracts.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.contracts.edit.title") };
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [t, loaded] = await Promise.all([
    getTranslations(),
    /^[0-9a-f-]{36}$/i.test(id)
      ? loadContractForm(id)
      : Promise.resolve({ kind: "missing" as const }),
  ]);
  if (loaded.kind !== "ready" || !loaded.contract)
    return (
      <ContractPageState
        state={loaded.kind === "ready" ? { kind: "missing" } : loaded}
        title={t("operations.contracts.edit.title")}
      />
    );
  return (
    <main className={styles.page} id="main-content">
      <PageHeader
        title={t("operations.contracts.edit.title")}
        description={loaded.contract.counterpartyName}
      />
      <ContractForm
        contract={loaded.contract}
        ownerName={loaded.ownerName}
        today={loaded.today}
      />
    </main>
  );
}
