import type { Metadata } from "next";
import { cache } from "react";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { ContractPageState } from "@/src/features/internal-ops/contracts/access-state";
import { ContractDetail } from "@/src/features/internal-ops/contracts/contract-detail";
import { contractTypeLabels } from "@/src/features/internal-ops/contracts/copy";
import { loadContract } from "@/src/features/internal-ops/contracts/loaders";
import { ContractHandoff } from "@/src/features/internal-ops/handoff/contract-handoff";

export const dynamic = "force-dynamic";

/** One read per request, shared by the document title and the page. */
const load = cache((id: string) => loadContract(id));

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
        ? t("operations.contracts.detail.documentTitle", {
            name: loaded.contract.counterpartyName,
            type: t(contractTypeLabels[loaded.contract.contractType]),
          })
        : t("operations.contracts.detail.title"),
  };
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
    load(id),
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
      previousSigning={loaded.previousSigning}
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
