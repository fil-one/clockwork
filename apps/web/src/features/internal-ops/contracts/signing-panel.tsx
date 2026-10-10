"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  contractDeletedInSignWell,
  contractVoidableStates,
  terminalContractSigningStates,
  type ContractSigningRecord,
} from "@clockwork/contracts";
import {
  Button,
  DescriptionList,
  Dialog,
  InlineNotice,
  ProgressSteps,
  StatusBadge,
  Textarea,
  buttonClassName,
  type ProgressStep,
} from "@clockwork/ui";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import { formatOperationalTimestamp } from "../presentation";
import { decideContract, operateContract, voidContract } from "./actions";
import { approvalStateLabels, errorMessage, signingStateLabels } from "./copy";
import styles from "./contracts.module.css";

type Operation = "send" | "sync" | "remind" | "cancel";

const sentStates = ["sent", "viewed", "awaiting_countersignature"];

function steps(
  signing: ContractSigningRecord,
  label: (id: Parameters<ReturnType<typeof useTranslations>>[0]) => string,
): ProgressStep[] {
  const order = [
    "draft",
    "preparing",
    "ready",
    "sending",
    "sent",
    "viewed",
    "awaiting_countersignature",
    "completed",
  ];
  const reached = order.indexOf(signing.state);
  const failed = ["declined", "expired", "canceled", "attention"].includes(
    signing.state,
  );
  const state = (done: boolean, current: boolean): ProgressStep["state"] =>
    done ? "complete" : current ? (failed ? "error" : "current") : "upcoming";
  const approved =
    signing.approvalState !== "pending" && signing.approvalState !== "rejected";
  const list: ProgressStep[] = [
    {
      id: "prepared",
      label: label("operations.contracts.signing.step.prepared"),
      state: "complete",
    },
  ];
  if (signing.approvalRequired)
    list.push({
      id: "approved",
      label: label("operations.contracts.signing.step.approved"),
      state:
        signing.approvalState === "rejected"
          ? "error"
          : state(approved, !approved),
    });
  list.push(
    {
      id: "sent",
      label: label("operations.contracts.signing.step.sent"),
      state: state(reached >= 4, approved && reached < 4),
    },
    {
      id: "counterparty",
      label: label("operations.contracts.signing.step.counterparty"),
      state: state(reached >= 6, reached >= 4 && reached < 6),
    },
    {
      id: "countersigned",
      label: label("operations.contracts.signing.step.countersigned"),
      state: state(reached === 7, reached === 6),
    },
  );
  return list;
}

export function SigningPanel({
  signing,
  generatedFileId,
  canWrite,
  canApprove,
  isPreparer,
  signingReady,
}: {
  signing: ContractSigningRecord;
  generatedFileId: string | null;
  canWrite: boolean;
  canApprove: boolean;
  isPreparer: boolean;
  signingReady: boolean;
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidReasonError, setVoidReasonError] = useState<string | null>(null);
  const terminal = terminalContractSigningStates.includes(signing.state);
  const approvalOk =
    signing.approvalState === "not_required" ||
    signing.approvalState === "approved";
  const unsent = !signing.providerId && !terminal;
  const deleted =
    signing.state === "attention" &&
    signing.error === contractDeletedInSignWell;
  // Voiding a colleague's request takes an approver, as the server checks.
  const canVoid =
    canWrite &&
    (isPreparer || canApprove) &&
    Boolean(signing.providerId) &&
    contractVoidableStates.includes(signing.state);

  async function run(
    key: string,
    action: () => Promise<{ ok: boolean; code?: string }>,
  ) {
    setBusy(key);
    setError(null);
    const result = await action();
    setBusy(null);
    if (!result.ok) setError(result.code ?? "UNEXPECTED");
    else router.refresh();
    return result.ok;
  }
  const operate = (operation: Operation) =>
    run(operation, () =>
      operateContract({ contractId: signing.contractId, operation }),
    );

  return (
    <section className={styles.card} aria-labelledby="contract-signing">
      <div className={styles.cardHeader}>
        <div>
          <h2 id="contract-signing">
            {t("operations.contracts.signing.title")}
          </h2>
          <p>
            {t("operations.contracts.signing.template", {
              version: signing.templateVersion,
            })}
          </p>
        </div>
        <StatusBadge
          tone={
            signing.state === "completed"
              ? "success"
              : signing.state === "attention" || signing.error
                ? "warning"
                : "info"
          }
        >
          {t(signingStateLabels[signing.state])}
        </StatusBadge>
      </div>
      <ProgressSteps
        className={styles.signingSteps ?? ""}
        label={t("operations.contracts.signing.progress")}
        steps={steps(signing, t)}
      />
      {signing.testMode ? (
        <InlineNotice
          tone="info"
          title={t("operations.contracts.signing.testMode")}
        />
      ) : null}
      {!signingReady && !terminal ? (
        <InlineNotice
          tone="warning"
          title={t("operations.contracts.error.signingNotConfigured")}
          description={t("operations.contracts.signing.notReadyBody")}
        />
      ) : null}
      {signing.error && !terminal && !deleted ? (
        <InlineNotice
          tone="warning"
          title={t("operations.contracts.error.provider")}
        />
      ) : null}
      {deleted ? (
        <InlineNotice
          tone="warning"
          title={t("operations.contracts.signing.deletedTitle")}
          description={t("operations.contracts.signing.deletedBody")}
        />
      ) : signing.state === "attention" ? (
        <InlineNotice
          tone="warning"
          title={t("operations.contracts.signing.attentionTitle")}
          description={t("operations.contracts.signing.attentionBody")}
        />
      ) : null}
      {error ? (
        <InlineNotice
          tone="danger"
          title={t(errorMessage(error))}
          live="assertive"
        />
      ) : null}

      <DescriptionList
        columns={2}
        items={[
          {
            term: t("operations.contracts.signing.counterpartySigner"),
            detail: `${signing.counterpartySigner.name}, ${signing.counterpartySigner.title} (${signing.counterpartySigner.email})`,
          },
          {
            term: t("operations.contracts.signing.countersigner"),
            detail: `${signing.countersigner.name}, ${signing.countersigner.title}`,
          },
          {
            term: t("operations.contracts.signing.preparedBy"),
            detail: `${signing.preparerName}, ${formatOperationalTimestamp(signing.createdAt, locale)}`,
          },
          {
            term: t("operations.contracts.signing.approval"),
            detail:
              signing.approvalState === "approved" ||
              signing.approvalState === "rejected"
                ? t(
                    signing.approvalState === "approved"
                      ? "operations.contracts.signing.approvedBy"
                      : "operations.contracts.signing.rejectedBy",
                    {
                      name: signing.approverName ?? "",
                      time: signing.decidedAt
                        ? formatOperationalTimestamp(signing.decidedAt, locale)
                        : "",
                    },
                  )
                : t(approvalStateLabels[signing.approvalState]),
          },
        ]}
      />
      {signing.approvalState === "rejected" && signing.rejectionReason ? (
        <InlineNotice
          tone="warning"
          title={t("operations.contracts.signing.rejectionReason")}
          description={signing.rejectionReason}
        />
      ) : null}
      {signing.approvalState === "pending" && !terminal ? (
        <p className={styles.muted}>
          {t(
            isPreparer
              ? "operations.contracts.signing.awaitingOthers"
              : canApprove
                ? "operations.contracts.signing.awaitingYou"
                : "operations.contracts.signing.awaitingApprover",
          )}
        </p>
      ) : null}

      <div className={`${styles.formActions} ${styles.spaced}`}>
        {generatedFileId ? (
          <a
            className={buttonClassName({ variant: "secondary" })}
            href={
              `/internal/contracts/${signing.contractId}/files/${generatedFileId}?view=1` as Route
            }
            target="_blank"
            rel="noreferrer"
          >
            {t("operations.contracts.signing.preview")}
          </a>
        ) : null}
        {signing.approvalState === "pending" &&
        canApprove &&
        !isPreparer &&
        !terminal ? (
          <>
            <Button
              loading={busy === "approve"}
              disabled={busy !== null}
              onClick={() =>
                void run("approve", () =>
                  decideContract({
                    contractId: signing.contractId,
                    approve: true,
                  }),
                )
              }
            >
              {t("operations.contracts.signing.approve")}
            </Button>
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => setRejecting((open) => !open)}
              aria-expanded={rejecting}
            >
              {t("operations.contracts.signing.reject")}
            </Button>
          </>
        ) : null}
        {canWrite &&
        approvalOk &&
        !terminal &&
        !deleted &&
        !sentStates.includes(signing.state) ? (
          <Button
            disabled={busy !== null || !signingReady}
            loading={busy === "send"}
            onClick={() => setConfirmSend(true)}
          >
            {t("operations.contracts.signing.send")}
          </Button>
        ) : null}
        {canWrite && signing.providerId && !terminal && !deleted ? (
          <Button
            variant="secondary"
            disabled={busy !== null || !signingReady}
            loading={busy === "sync"}
            onClick={() => void operate("sync")}
          >
            {t("operations.contracts.signing.refresh")}
          </Button>
        ) : null}
        {canWrite && sentStates.includes(signing.state) ? (
          <Button
            variant="secondary"
            disabled={busy !== null || !signingReady}
            loading={busy === "remind"}
            onClick={() => void operate("remind")}
          >
            {t(
              signing.state === "awaiting_countersignature"
                ? "operations.contracts.signing.remindCountersigner"
                : "operations.contracts.signing.remindCounterparty",
              {
                name:
                  signing.state === "awaiting_countersignature"
                    ? signing.countersigner.name
                    : signing.counterpartySigner.name,
              },
            )}
          </Button>
        ) : null}
        {canWrite && unsent ? (
          <Button
            variant="quiet"
            disabled={busy !== null}
            loading={busy === "cancel"}
            onClick={() => {
              if (
                window.confirm(t("operations.contracts.signing.discardConfirm"))
              )
                void operate("cancel");
            }}
          >
            {t("operations.contracts.signing.discard")}
          </Button>
        ) : null}
        {canVoid ? (
          <Button
            variant="quiet"
            disabled={busy !== null || !signingReady}
            onClick={() => {
              setVoidReason("");
              setVoidReasonError(null);
              setVoiding(true);
            }}
          >
            {t("operations.contracts.signing.void.action")}
          </Button>
        ) : null}
      </div>

      {rejecting ? (
        <form
          className={styles.reasonForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (!reason.trim()) {
              setReasonError(t("operations.contracts.error.reasonRequired"));
              return;
            }
            setReasonError(null);
            void run("reject", () =>
              decideContract({
                contractId: signing.contractId,
                approve: false,
                reason,
              }),
            ).then((ok) => ok && setRejecting(false));
          }}
        >
          <Textarea
            label={t("operations.contracts.signing.reasonLabel")}
            help={t("operations.contracts.signing.reasonHelp")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            rows={3}
            error={reasonError ?? undefined}
          />
          <div className={styles.formActions}>
            <Button type="submit" variant="danger" loading={busy === "reject"}>
              {t("operations.contracts.signing.confirmReject")}
            </Button>
            <Button variant="quiet" onClick={() => setRejecting(false)}>
              {t("operations.contracts.form.cancel")}
            </Button>
          </div>
        </form>
      ) : null}

      <Dialog
        open={confirmSend}
        onOpenChange={setConfirmSend}
        title={t("operations.contracts.signing.confirmSendTitle")}
        description={t("operations.contracts.signing.confirmSendBody", {
          signer: signing.counterpartySigner.name,
          email: signing.counterpartySigner.email,
          countersigner: signing.countersigner.name,
        })}
        closeLabel={t("operations.contracts.form.cancel")}
        trigger={<span hidden />}
        footer={
          <Button
            loading={busy === "send"}
            onClick={() => {
              setConfirmSend(false);
              void operate("send");
            }}
          >
            {t("operations.contracts.signing.send")}
          </Button>
        }
      >
        {null}
      </Dialog>
      <Dialog
        open={voiding}
        onOpenChange={setVoiding}
        title={t("operations.contracts.signing.void.title")}
        description={t("operations.contracts.signing.void.description", {
          signer: signing.counterpartySigner.name,
        })}
        closeLabel={t("operations.contracts.signing.void.keep")}
        trigger={<span hidden />}
        footer={
          <Button
            variant="danger"
            loading={busy === "void"}
            loadingLabel={t("operations.contracts.signing.void.working")}
            onClick={() => {
              if (voidReason.trim().length < 3) {
                setVoidReasonError(
                  t("operations.contracts.signing.void.reasonRequired"),
                );
                return;
              }
              void run("void", () =>
                voidContract({
                  contractId: signing.contractId,
                  reason: voidReason.trim(),
                }),
              ).then(() => setVoiding(false));
            }}
          >
            {t("operations.contracts.signing.void.confirm")}
          </Button>
        }
      >
        <p className={styles.muted}>
          {t("operations.contracts.signing.void.evidence")}
        </p>
        <Textarea
          label={t("operations.contracts.signing.void.reason")}
          help={t("operations.contracts.signing.void.reasonHelp")}
          value={voidReason}
          onChange={(e) => {
            setVoidReason(e.target.value);
            setVoidReasonError(null);
          }}
          maxLength={500}
          rows={3}
          required
          error={voidReasonError ?? undefined}
        />
      </Dialog>
    </section>
  );
}
