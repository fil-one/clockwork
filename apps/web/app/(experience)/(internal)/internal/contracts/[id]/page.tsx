import type { Metadata } from "next";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { ContractPageState } from "@/src/features/internal-ops/contracts/access-state";
import { ContractDetail } from "@/src/features/internal-ops/contracts/contract-detail";
import { loadContract } from "@/src/features/internal-ops/contracts/loaders";
import { ContractHandoff } from "@/src/features/internal-ops/handoff/contract-handoff";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.contracts.detail.title") };
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [t, locale, loaded] = await Promise.all([
    getTranslations(),
    getFormattingLocale(),
    loadContract(id),
  ]);
  if (loaded.kind !== "ready")
    return (
      <ContractPageState
        state={loaded}
        title={t("operations.contracts.detail.title")}
      />
    );
  return (
    <ContractDetail
      t={t}
      locale={locale}
      contract={loaded.contract}
      files={loaded.files}
      activity={loaded.activity}
      signing={loaded.signing}
      paperSources={loaded.paperSources}
      countersigners={loaded.countersigners}
      today={loaded.today}
      canWrite={loaded.canWrite}
      canApprove={loaded.canApprove}
      isPreparer={loaded.isPreparer}
      canSelfApprove={loaded.canSelfApprove}
      signingReady={loaded.signingReady}
      handoff={
        loaded.canWrite ? (
          <ContractHandoff contractId={loaded.contract.id} />
        ) : null
      }
    />
  );
}
