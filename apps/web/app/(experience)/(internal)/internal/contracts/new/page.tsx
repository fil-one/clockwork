import type { Metadata } from "next";
import { contractTypes, type ContractType } from "@clockwork/contracts";
import { PageHeader } from "@clockwork/ui";
import { getTranslations } from "@/src/i18n/server";
import { ContractPageState } from "@/src/features/internal-ops/contracts/access-state";
import { ContractForm } from "@/src/features/internal-ops/contracts/contract-form";
import { loadContractForm } from "@/src/features/internal-ops/contracts/loaders";
import styles from "@/src/features/internal-ops/contracts/contracts.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.contracts.new.title") };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string | string[];
    mnda?: string | string[];
  }>;
}) {
  const { type, mnda } = await searchParams;
  // A signed MNDA fills the counterparty; an id the reader cannot open
  // starts an empty form.
  const [t, loaded] = await Promise.all([
    getTranslations(),
    loadContractForm(undefined, typeof mnda === "string" ? mnda : undefined),
  ]);
  if (loaded.kind !== "ready")
    return (
      <ContractPageState
        state={loaded}
        title={t("operations.contracts.new.title")}
      />
    );
  const initialType = (contractTypes as readonly string[]).includes(
    String(type),
  )
    ? (type as ContractType)
    : undefined;
  return (
    <main className={styles.page} id="main-content">
      <PageHeader
        title={t("operations.contracts.new.title")}
        description={t("operations.contracts.new.description")}
      />
      <ContractForm
        contract={null}
        ownerName={loaded.ownerName}
        today={loaded.today}
        {...(initialType ? { initialType } : {})}
        {...(loaded.mnda ? { fromMnda: loaded.mnda } : {})}
      />
    </main>
  );
}
