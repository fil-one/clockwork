"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import {
  contractDeletedInSignWell,
  contractSignerEmail,
  contractVoidableStates,
  terminalContractSigningStates,
  type ContractSigningRecord,
} from "@clockwork/contracts";
import {
  Button,
  DescriptionList,
  Dialog,
  InlineNotice,
  Input,
  ProgressSteps,
  StatusBadge,
  Textarea,
  buttonClassName,
  type ProgressStep,
} from "@clockwork/ui";
import type { MessageId } from "@/src/i18n";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import { formatOperationalTimestamp } from "../presentation";
import {
  correctContractSigner,
  decideContract,
  operateContract,
  voidContract,
} from "./actions";
import { approvalStateLabels, errorMessage, signingStateLabels } from "./copy";
import { SessionExpiredReload } from "../session-expiry";
import { SelfApprovalDialog } from "../self-approval/self-approval-dialog";
import styles from "./contracts.module.css";

type Operation = "send" | "sync" | "remind" | "cancel";

/** Why SignWell's copy is not applied, for each mismatch code. */
const mismatchNotes: Readonly<Record<string, MessageId>> = {
  signwell_signers_mismatch: "operations.contracts.signing.signersMismatch",
  signwell_binding_mismatch: "operations.contracts.signing.bindingMismatch",
  signwell_signed_mismatch: "operations.contracts.signing.signedMismatch",
  signwell_fields_mismatch: "operations.contracts.signing.fieldsMismatch",
};

/** Refusals that come after the request's new state was stored. */
const storedBeforeRefusal = new Set([
  "CONTRACT_NEEDS_ATTENTION",
  "CONTRACT_NOT_PENDING",
  "CONTRACT_STILL_PREPARING",
  "CONTRACT_ALREADY_COMPLETED",
  "CONTRACT_NOT_VOIDABLE",
]);

const sentStates = ["sent", "viewed", "awaiting_countersignature"];

/** Prepares the same template again with the previous values and the
 * counterparty signer left blank. */
export const prepareAgainHref = (signing: ContractSigningRecord) =>
  `/internal/contracts/templates/${signing.templateId}?from=${signing.contractId}` as Route;

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
    ...(signing.counterpartySigns
      ? [
          {
            id: "counterparty",
            label: label("operations.contracts.signing.step.counterparty"),
            state: state(reached >= 6, reached >= 4 && reached < 6),
          },
        ]
      : []),
    {
      id: "countersigned",
      label: label("operations.contracts.signing.step.countersigned"),
      // Fil One alone signs counterparty paper signed already.
      state: signing.counterpartySigns
        ? state(reached === 7, reached === 6)
        : state(reached === 7, reached >= 4 && reached < 7),
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
  canSelfApprove = false,
  signingReady,
}: {
  signing: ContractSigningRecord;
  generatedFileId: string | null;
  canWrite: boolean;
  canApprove: boolean;
  isPreparer: boolean;
  /** The reader holds `approval:self` in their own MFA-verified session. */
  canSelfApprove?: boolean;
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
  // The void is for a different counterparty signer: no reason is typed,
  // and the template opens again afterwards.
  const [signerChange, setSignerChange] = useState(false);
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
  const mismatch =
    signing.state === "attention"
      ? mismatchNotes[signing.error ?? ""]
      : undefined;
  // Waits for a person to void it; sending changes nothing. A mismatched copy
  // can still be refreshed: the hold clears once SignWell's copy matches.
  const held = deleted || Boolean(mismatch);
  // Someone signed SignWell's copy: it is resolved in SignWell, never voided.
  const signedMismatch =
    signing.state === "attention" &&
    signing.error === "signwell_signed_mismatch";
  // Voiding a colleague's request takes an approver, as the server checks.
  const canVoid =
    canWrite &&
    (isPreparer || canApprove) &&
    Boolean(signing.providerId) &&
    !signedMismatch &&
    contractVoidableStates.includes(signing.state);
  // The counterparty's email can be fixed until they start signing; a bounce
  // or SignWell showing another address puts the request in attention first.
  const canCorrect =
    canVoid &&
    signing.counterpartySigns &&
    (["sent", "viewed"].includes(signing.state) ||
      (signing.state === "attention" &&
        ["recipient_bounced", "signwell_signers_mismatch"].includes(
          signing.error ?? "",
        )));
  const bounced =
    signing.state === "attention" && signing.error === "recipient_bounced";
  const paper = signing.documentType === "counterparty_paper";
  // Who a reminder goes to: Fil One once the counterparty has signed, or
  // from the start when Fil One alone signs.
  const filOneNext =
    signing.state === "awaiting_countersignature" || !signing.counterpartySigns;

  async function run(
    key: string,
    action: () => Promise<{ ok: boolean; code?: string }>,
  ) {
    setBusy(key);
    setError(null);
    const result = await action();
    setBusy(null);
    if (!result.ok) setError(result.code ?? "UNEXPECTED");
    // These refusals follow a fresh read of SignWell whose state is stored,
    // so the panel reloads to show it.
    if (result.ok || storedBeforeRefusal.has(result.code ?? ""))
      router.refresh();
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
            {t(
              paper
                ? "operations.contracts.signing.paperSource"
                : "operations.contracts.signing.template",
              { version: signing.templateVersion },
            )}
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
      {signing.error === "provider_unavailable" && !terminal ? (
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
      ) : mismatch ? (
        <InlineNotice
          tone="warning"
          title={t(mismatch)}
          description={t(
            signedMismatch
              ? "operations.contracts.signing.signedMismatchNext"
              : paper
                ? "operations.contracts.signing.mismatchNextPaper"
                : "operations.contracts.signing.mismatchNext",
          )}
        />
      ) : bounced ? (
        <InlineNotice
          tone="warning"
          title={t("operations.contracts.signing.bouncedTitle")}
          description={t("operations.contracts.signing.bouncedBody")}
        />
      ) : signing.state === "attention" ? (
        <InlineNotice
          tone="warning"
          title={t("operations.contracts.signing.attentionTitle")}
          description={t("operations.contracts.signing.attentionBody")}
        />
      ) : paper &&
        ["declined", "expired", "canceled"].includes(signing.state) ? (
        <InlineNotice
          tone="info"
          title={t("operations.contracts.signing.paperClosedTitle")}
          description={t("operations.contracts.signing.paperClosedBody")}
          {...(canWrite
            ? {
                action: (
                  <Link
                    className={buttonClassName({ variant: "secondary" })}
                    href={
                      `/internal/contracts/new?from=${signing.contractId}` as Route
                    }
                  >
                    {t("operations.contracts.signing.recordAgain")}
                  </Link>
                ),
              }
            : {})}
        />
      ) : signing.cancelCode === "signer_change" ? (
        <InlineNotice
          tone="info"
          title={t("operations.contracts.signing.signerChangeTitle")}
          description={t("operations.contracts.signing.signerChangeBody")}
          {...(canWrite && !paper
            ? {
                action: (
                  <Link
                    className={buttonClassName({ variant: "secondary" })}
                    href={prepareAgainHref(signing)}
                  >
                    {t("operations.contracts.signing.prepareAgain")}
                  </Link>
                ),
              }
            : {})}
        />
      ) : null}
      {error ? (
        <InlineNotice
          tone="danger"
          title={t(errorMessage(error))}
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

      <DescriptionList
        columns={2}
        items={[
          {
            term: t("operations.contracts.signing.counterpartySigner"),
            detail: signing.counterpartySigns
              ? `${signing.counterpartySigner.name}, ${signing.counterpartySigner.title} (${contractSignerEmail(signing)})`
              : t("operations.contracts.signing.signedOnPaper"),
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
        {signing.approvalState === "pending" &&
        canApprove &&
        isPreparer &&
        canSelfApprove &&
        !terminal ? (
          <SelfApprovalDialog
            subject={signing.documentName}
            disabled={busy !== null}
            onConfirm={async (reason) => {
              const result = await decideContract({
                contractId: signing.contractId,
                approve: true,
                selfApprovalReason: reason,
              });
              if (result.ok) {
                router.refresh();
                return { ok: true };
              }
              return {
                ok: false,
                message: t(errorMessage(result.code)),
                expired: result.code === "SESSION_EXPIRED",
              };
            }}
          />
        ) : null}
        {canWrite &&
        approvalOk &&
        !terminal &&
        !held &&
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
              filOneNext
                ? "operations.contracts.signing.remindCountersigner"
                : "operations.contracts.signing.remindCounterparty",
              {
                name: filOneNext
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
        {canCorrect ? (
          <CorrectSignerDialog
            signing={signing}
            disabled={busy !== null || !signingReady}
            onDone={() => router.refresh()}
            // Counterparty paper has one signing request per contract, so a
            // different signer is not prepared again from here.
            {...(paper
              ? {}
              : {
                  onSomeoneElse: () => {
                    setSignerChange(true);
                    setVoiding(true);
                  },
                })}
          />
        ) : null}
        {canVoid ? (
          <Button
            variant="quiet"
            disabled={busy !== null || !signingReady}
            onClick={() => {
              setVoidReason("");
              setVoidReasonError(null);
              setSignerChange(false);
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
        description={
          signing.counterpartySigns
            ? t("operations.contracts.signing.confirmSendBody", {
                signer: signing.counterpartySigner.name,
                email: signing.counterpartySigner.email,
                countersigner: signing.countersigner.name,
              })
            : t("operations.contracts.signing.confirmSendFilOneBody", {
                countersigner: signing.countersigner.name,
              })
        }
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
              if (!signerChange && voidReason.trim().length < 3) {
                setVoidReasonError(
                  t("operations.contracts.signing.void.reasonRequired"),
                );
                return;
              }
              void run("void", () =>
                voidContract(
                  signerChange
                    ? { contractId: signing.contractId, code: "signer_change" }
                    : {
                        contractId: signing.contractId,
                        reason: voidReason.trim(),
                      },
                ),
              ).then((ok) => {
                setVoiding(false);
                if (ok && signerChange) router.push(prepareAgainHref(signing));
              });
            }}
          >
            {t("operations.contracts.signing.void.confirm")}
          </Button>
        }
      >
        <p className={styles.muted}>
          {t("operations.contracts.signing.void.evidence")}
        </p>
        {signerChange ? (
          <p className={styles.muted}>
            {t("operations.contracts.signing.void.signerChangeNote")}
          </p>
        ) : (
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
        )}
      </Dialog>
    </section>
  );
}

/** Refusals after which the counterparty's email cannot be fixed here. */
const notCorrectable = new Set([
  "CONTRACT_SIGNER_STARTED",
  "CONTRACT_NOT_CORRECTABLE",
]);

/**
 * Fixes a bounced or mistyped counterparty email in place; SignWell sends the
 * request to the new address and the signer's name stays. When a different
 * person must sign, the request is voided and the template prepared again.
 */
function CorrectSignerDialog({
  signing,
  disabled,
  onDone,
  onSomeoneElse,
}: {
  signing: ContractSigningRecord;
  disabled: boolean;
  onDone: () => void;
  /** Absent where the request cannot be prepared again for someone else. */
  onSomeoneElse?: () => void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(contractSignerEmail(signing));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldId = `contract-correct-email-${signing.contractId}`;
  async function save() {
    setBusy(true);
    try {
      const result = await correctContractSigner({
        contractId: signing.contractId,
        signerEmail: email.trim(),
      });
      if (!result.ok) {
        setError(result.code);
        document.getElementById(fieldId)?.focus();
        // SignWell's state was read and stored before these refusals.
        if (notCorrectable.has(result.code)) onDone();
        return;
      }
      setOpen(false);
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={t("operations.contracts.signing.correct.title")}
      description={t("operations.contracts.signing.correct.description", {
        name: signing.counterpartySigner.name,
      })}
      trigger={
        <Button variant="secondary" disabled={disabled}>
          {t("operations.contracts.signing.correct.action")}
        </Button>
      }
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setEmail(contractSignerEmail(signing));
          setError(null);
        }
      }}
      closeLabel={t("operations.contracts.form.cancel")}
      footer={
        <>
          {onSomeoneElse ? (
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                onSomeoneElse();
              }}
            >
              {t("operations.contracts.signing.correct.someoneElse")}
            </Button>
          ) : null}
          <Button
            loading={busy}
            disabled={error !== null && notCorrectable.has(error)}
            loadingLabel={t("operations.contracts.signing.correct.working")}
            onClick={() => void save()}
          >
            {t("operations.contracts.signing.correct.confirm")}
          </Button>
        </>
      }
    >
      <Input
        id={fieldId}
        type="email"
        label={t("operations.contracts.prepare.signerEmail")}
        value={email}
        maxLength={254}
        required
        help={t("operations.contracts.signing.correct.help")}
        {...(error
          ? {
              error: t(
                error === "INVALID_INPUT"
                  ? "operations.contracts.field.error.email"
                  : errorMessage(error),
              ),
            }
          : {})}
        onChange={(e) => {
          setEmail(e.target.value);
          setError(null);
        }}
      />
      {error === "SESSION_EXPIRED" ? (
        <SessionExpiredReload onReloaded={() => setError(null)} />
      ) : null}
    </Dialog>
  );
}
