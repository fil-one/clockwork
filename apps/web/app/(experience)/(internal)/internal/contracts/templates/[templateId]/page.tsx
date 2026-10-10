import type { Metadata } from "next";
import Link from "next/link";
import {
  ApplicationStatePanel,
  PageHeader,
  buttonClassName,
} from "@clockwork/ui";
import { getTranslations } from "@/src/i18n/server";
import { ContractPageState } from "@/src/features/internal-ops/contracts/access-state";
import { contractTypeLabels } from "@/src/features/internal-ops/contracts/copy";
import { loadPrepare } from "@/src/features/internal-ops/contracts/loaders";
import { PrepareForm } from "@/src/features/internal-ops/contracts/prepare-form";
import styles from "@/src/features/internal-ops/contracts/contracts.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.contracts.prepare.title") };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ templateId: string }>;
  /** `from`: an earlier contract from this template whose values the form
   * starts from, for a different counterparty signer. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ templateId }, { from }] = await Promise.all([params, searchParams]);
  const [t, loaded] = await Promise.all([
    getTranslations(),
    loadPrepare(templateId, typeof from === "string" ? from : undefined),
  ]);
  if (loaded.kind !== "ready")
    return (
      <ContractPageState
        state={loaded}
        title={t("operations.contracts.prepare.title")}
      />
    );
  const { template } = loaded;
  const name = t(contractTypeLabels[template.contractType]);
  return (
    <main className={styles.page} id="main-content">
      <PageHeader
        eyebrow={t("operations.contracts.prepare.title")}
        title={name}
        description={
          template.status === "available"
            ? t("operations.contracts.prepare.description", {
                version: template.version,
              })
            : undefined
        }
      />
      {template.status !== "available" ? (
        <ApplicationStatePanel
          state="empty"
          title={t("operations.contracts.templates.pending")}
          description={t("operations.contracts.templates.pendingBody")}
          action={
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href={`/internal/contracts/new?type=${template.contractType}`}
            >
              {t("operations.contracts.templates.recordInstead")}
            </Link>
          }
        />
      ) : loaded.countersigners.length === 0 ? (
        <ApplicationStatePanel
          state="partial"
          title={t("operations.contracts.prepare.noCountersignerTitle")}
          description={t("operations.contracts.prepare.noCountersignerBody")}
        />
      ) : (
        <PrepareForm
          template={template}
          countersigners={loaded.countersigners}
          ownerName={loaded.ownerName}
          today={loaded.today}
          signingReady={loaded.signingReady}
          start={loaded.start}
        />
      )}
    </main>
  );
}
