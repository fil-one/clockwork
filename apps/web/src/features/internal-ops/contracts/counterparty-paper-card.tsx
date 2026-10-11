"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import type { ContractFileRecord, ContractPaper } from "@clockwork/contracts";
import { Button, InlineNotice, Input, RadioGroup, Select } from "@clockwork/ui";
import { useTranslations } from "@/src/i18n/client";
import { prepareCounterpartyPaper } from "./actions";
import { errorMessage, fieldMessage } from "./copy";
import type { Countersigner } from "./prepare-form";
import { SessionExpiredReload } from "../session-expiry";
import styles from "./contracts.module.css";

type Signers = "fil-one" | "counterparty_then_fil_one";

/**
 * Sends one of a contract's uploaded PDFs for signature, on either party's
 * paper, with the Fil One signature page appended. On Fil One's own paper
 * the counterparty signs first by default; on theirs, Fil One alone. Preparing
 * it records the request; approval and sending follow on the signing panel.
 * After a request ended, the card offers the next one under the panel.
 */
export function CounterpartyPaperCard({
  contractId,
  paper,
  again = false,
  files,
  countersigners,
  signingReady,
}: {
  contractId: string;
  paper: ContractPaper;
  /** An earlier request ended; this one replaces it. */
  again?: boolean;
  files: readonly ContractFileRecord[];
  countersigners: readonly Countersigner[];
  signingReady: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const formId = useId();
  const [signers, setSigners] = useState<Signers>(
    paper === "ours" ? "counterparty_then_fil_one" : "fil-one",
  );
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const defaultSigner =
    countersigners.find((signer) => signer.isDefault) ?? countersigners[0];
  const latest = files.at(-1);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
    setBusy(true);
    setError(null);
    const result = await prepareCounterpartyPaper({
      contractId,
      fileId: text("fileId"),
      countersignerId: text("countersignerId"),
      signers,
      ...(signers === "counterparty_then_fil_one"
        ? {
            signerName: text("signerName"),
            signerEmail: text("signerEmail"),
            signerTitle: text("signerTitle"),
          }
        : {}),
    });
    setBusy(false);
    if (result.ok) {
      router.refresh();
      return;
    }
    setProblems(result.fields ?? {});
    if (!result.fields) setError(result.code);
  }
  const fieldError = (name: string) =>
    problems[name] ? t(fieldMessage(problems[name], name)) : undefined;

  return (
    <section className={styles.card} aria-labelledby={`${formId}-title`}>
      <div className={styles.cardHeader}>
        <div>
          <h2 id={`${formId}-title`}>
            {t(
              again
                ? "operations.contracts.paperSend.titleAgain"
                : "operations.contracts.paperSend.title",
            )}
          </h2>
          <p>
            {t(
              again
                ? "operations.contracts.paperSend.descriptionAgain"
                : "operations.contracts.paperSend.description",
            )}
          </p>
        </div>
      </div>
      {countersigners.length === 0 ? (
        <InlineNotice
          tone="warning"
          title={t("operations.contracts.prepare.noCountersignerTitle")}
          description={t("operations.contracts.prepare.noCountersignerBody")}
        />
      ) : (
        <form
          className={styles.form}
          onSubmit={(event) => void submit(event)}
          noValidate
        >
          {error ? (
            <InlineNotice
              tone="danger"
              title={t("operations.contracts.paperSend.notPrepared")}
              description={t(errorMessage(error))}
              live="assertive"
              {...(error === "SESSION_EXPIRED"
                ? {
                    action: (
                      <SessionExpiredReload onReloaded={() => setError(null)} />
                    ),
                  }
                : {})}
            />
          ) : null}
          {!signingReady ? (
            <InlineNotice
              tone="warning"
              title={t("operations.contracts.error.signingNotConfigured")}
              description={t("operations.contracts.prepare.notReadyBody")}
            />
          ) : null}
          <div className={styles.fieldGrid}>
            <Select
              id={`${formId}-fileId`}
              name="fileId"
              label={t("operations.contracts.paperSend.file")}
              defaultValue={latest?.id ?? ""}
              options={files.map((file) => ({
                value: file.id,
                label: file.fileName,
              }))}
              error={fieldError("fileId")}
            />
            <Select
              id={`${formId}-countersignerId`}
              name="countersignerId"
              label={t("operations.contracts.prepare.countersigner")}
              defaultValue={defaultSigner?.id ?? ""}
              options={countersigners.map((signer) => ({
                value: signer.id,
                label: `${signer.name}, ${signer.title}`,
              }))}
              error={fieldError("countersignerId")}
            />
          </div>
          <RadioGroup
            legend={t("operations.contracts.paperSend.signers")}
            name="signers"
            value={signers}
            onChange={(event) => setSigners(event.target.value as Signers)}
            options={[
              {
                value: "counterparty_then_fil_one" as const,
                label: t("operations.contracts.paperSend.both"),
                description: t("operations.contracts.paperSend.bothHelp"),
              },
              {
                value: "fil-one" as const,
                label: t("operations.contracts.paperSend.filOneOnly"),
                description: t("operations.contracts.paperSend.filOneOnlyHelp"),
              },
            ]}
          />
          {signers === "counterparty_then_fil_one" ? (
            <div className={styles.fieldGrid}>
              <Input
                id={`${formId}-signerName`}
                name="signerName"
                label={t("operations.contracts.prepare.signerName")}
                maxLength={120}
                required
                error={fieldError("signerName")}
              />
              <Input
                id={`${formId}-signerEmail`}
                name="signerEmail"
                type="email"
                label={t("operations.contracts.prepare.signerEmail")}
                maxLength={254}
                required
                error={fieldError("signerEmail")}
              />
              <Input
                id={`${formId}-signerTitle`}
                name="signerTitle"
                label={t("operations.contracts.prepare.signerTitle")}
                maxLength={120}
                required
                error={fieldError("signerTitle")}
              />
            </div>
          ) : null}
          <p className={styles.muted}>
            {t("operations.contracts.paperSend.approvalNote")}
          </p>
          <div className={styles.formActions}>
            <Button
              type="submit"
              loading={busy}
              loadingLabel={t("operations.contracts.prepare.preparing")}
            >
              {t("operations.contracts.paperSend.submit")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
