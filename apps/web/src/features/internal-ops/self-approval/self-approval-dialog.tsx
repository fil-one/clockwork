"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

import { Button, Dialog, Textarea } from "@clockwork/ui";

import { useTranslations } from "@/src/i18n/client";

import {
  selfApprovalReasonMaximum,
  selfApprovalReasonMinimum,
  type SelfApprovalOutcome,
} from "./model";

/**
 * "Approve my own request": a commerce administrator approving a request
 * they raised. The dialog asks why; the reason goes with the decision, and
 * the other commerce administrators are told. `children` holds any further
 * field the control needs for an approval (evidence), and `ready` says
 * whether those are filled in.
 */
export function SelfApprovalDialog({
  subject,
  onConfirm,
  disabled = false,
  ready = true,
  initialReason = "",
  children,
}: {
  /** What is being approved, already worded for the reader. */
  subject: string;
  /** Sends the approval with the self-approval flag and this reason. */
  onConfirm: (reason: string) => Promise<SelfApprovalOutcome>;
  disabled?: boolean;
  ready?: boolean;
  initialReason?: string;
  children?: ReactNode;
}) {
  const t = useTranslations();
  const fieldId = `self-approval-reason-${useId().replaceAll(":", "")}`;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(initialReason);
  const [error, setError] = useState<string | null>(null);
  const [tooShort, setTooShort] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setReason(initialReason);
    setError(null);
    setTooShort(false);
  }, [open, initialReason]);

  async function confirm() {
    const trimmed = reason.trim();
    if (
      trimmed.length < selfApprovalReasonMinimum ||
      trimmed.length > selfApprovalReasonMaximum
    ) {
      setTooShort(true);
      document.getElementById(fieldId)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const outcome = await onConfirm(trimmed);
      if (outcome.ok) setOpen(false);
      else setError(outcome.message);
    } catch {
      setError(t("common.selfApproval.error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t("common.selfApproval.title")}
      description={t("common.selfApproval.description", { subject })}
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
      closeLabel={t("common.selfApproval.cancel")}
      trigger={
        <Button variant="secondary" disabled={disabled}>
          {t("common.selfApproval.action")}
        </Button>
      }
      footer={
        <Button
          variant="primary"
          loading={busy}
          loadingLabel={t("common.selfApproval.working")}
          disabled={!ready}
          onClick={() => void confirm()}
        >
          {t("common.selfApproval.action")}
        </Button>
      }
    >
      <Textarea
        id={fieldId}
        label={t("common.selfApproval.reason")}
        help={t("common.selfApproval.reasonHelp")}
        value={reason}
        minLength={selfApprovalReasonMinimum}
        maxLength={selfApprovalReasonMaximum}
        rows={3}
        required
        error={tooShort ? t("common.selfApproval.error.reason") : undefined}
        onChange={(event) => {
          setReason(event.target.value);
          setTooShort(false);
        }}
      />
      {children}
      {error ? (
        <p className="cw-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
