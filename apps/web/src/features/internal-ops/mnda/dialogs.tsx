"use client";
import { useEffect, useState, type ReactNode } from "react";
import {
  mndaSignerEmail,
  type MndaErrorCode,
  type MndaRecord,
} from "@clockwork/contracts";
import { Button, Dialog, Input, Textarea } from "@clockwork/ui";
import { useTranslations } from "@/src/i18n/client";
import { correctMndaSigner, voidMnda } from "./actions";
import { mndaErrorLabels } from "./labels";
import { SessionExpiredReload } from "../session-expiry";
import styles from "./workspace.module.css";

/**
 * Voids a sent MNDA. SignWell stops the request and deletes its copy; the
 * original PDF and the history stay here. With `signerChange` no reason is
 * typed: the void is recorded as "a different person will sign".
 */
export function VoidDialog({
  record,
  trigger,
  signerChange = false,
  open,
  onOpenChange,
  onDone,
}: {
  record: MndaRecord;
  trigger: ReactNode;
  signerChange?: boolean;
  open?: boolean | undefined;
  onOpenChange?: (open: boolean) => void;
  onDone: (record: MndaRecord) => void;
}) {
  const t = useTranslations();
  const [ownOpen, setOwnOpen] = useState(false);
  const isOpen = open ?? ownOpen;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    setOwnOpen(next);
  };
  const [reason, setReason] = useState("");
  const [error, setError] = useState<MndaErrorCode | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    setReason("");
    setError(null);
  }, [isOpen]);
  const [busy, setBusy] = useState(false);
  const fieldId = `mnda-void-reason-${record.id}`;
  async function confirm() {
    if (!signerChange && reason.trim().length < 3) {
      setError("reason_required");
      document.getElementById(fieldId)?.focus();
      return;
    }
    setBusy(true);
    try {
      const result = await voidMnda(
        signerChange
          ? { id: record.id, code: "signer_change" }
          : { id: record.id, reason: reason.trim() },
      );
      if (!result.ok) {
        setError(result.code);
        return;
      }
      setOpen(false);
      onDone(result.value);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={t("operations.mnda.void.title")}
      description={t("operations.mnda.void.description", {
        company: record.input.company,
      })}
      trigger={trigger}
      open={isOpen}
      onOpenChange={setOpen}
      closeLabel={t("operations.mnda.void.keep")}
      footer={
        <Button
          variant="danger"
          loading={busy}
          loadingLabel={t("operations.mnda.void.working")}
          onClick={() => void confirm()}
        >
          {t("operations.mnda.void.confirm")}
        </Button>
      }
    >
      <p className={styles.muted}>{t("operations.mnda.void.evidence")}</p>
      {signerChange ? (
        <p className={styles.muted}>
          {t("operations.mnda.void.signerChangeNote")}
        </p>
      ) : (
        <ReasonField
          id={fieldId}
          value={reason}
          onChange={(value) => {
            setReason(value);
            setError(null);
          }}
          error={
            error === "reason_required" ? t(mndaErrorLabels[error]) : undefined
          }
        />
      )}
      {error && error !== "reason_required" ? (
        <p className={styles.fieldError} role="alert">
          {t(mndaErrorLabels[error])}
        </p>
      ) : null}
      {error === "session_expired" ? (
        <SessionExpiredReload onReloaded={() => setError(null)} />
      ) : null}
    </Dialog>
  );
}
function ReasonField({
  id,
  value,
  onChange,
  error,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
}) {
  const t = useTranslations();
  return (
    <Textarea
      id={id}
      label={t("operations.mnda.void.reason")}
      help={t("operations.mnda.void.reasonHelp")}
      value={value}
      maxLength={500}
      rows={3}
      required
      {...(error ? { error } : {})}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Confirms discarding a draft that was never sent. */
export function DiscardDialog({
  record,
  trigger,
  onConfirm,
}: {
  record: MndaRecord;
  trigger: ReactNode;
  onConfirm: () => Promise<boolean>;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title={t("operations.mnda.discard.title")}
      description={t("operations.mnda.discard.description", {
        company: record.input.company,
      })}
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      closeLabel={t("operations.mnda.discard.keep")}
      footer={
        <Button
          variant="danger"
          loading={busy}
          onClick={() => {
            setBusy(true);
            void onConfirm()
              .then((done) => {
                if (done) setOpen(false);
              })
              .finally(() => setBusy(false));
          }}
        >
          {t("operations.mnda.discardDraft")}
        </Button>
      }
    >
      <p className={styles.muted}>{t("operations.mnda.discard.evidence")}</p>
    </Dialog>
  );
}

/**
 * Fixes a bounced or mistyped partner email in place. When the partner has
 * started signing, or a different person must sign, the request is voided and
 * a new one prepared from the same details.
 */
export function CorrectSignerDialog({
  record,
  trigger,
  onDone,
  onSendToSomeoneElse,
}: {
  record: MndaRecord;
  trigger: ReactNode;
  onDone: (record: MndaRecord) => void;
  onSendToSomeoneElse: () => void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(mndaSignerEmail(record));
  const [error, setError] = useState<MndaErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldId = `mnda-correct-email-${record.id}`;
  async function save() {
    setBusy(true);
    try {
      const result = await correctMndaSigner({
        id: record.id,
        signerEmail: email.trim(),
      });
      if (!result.ok) {
        setError(result.code);
        document.getElementById(fieldId)?.focus();
        return;
      }
      setOpen(false);
      onDone(result.value);
    } finally {
      setBusy(false);
    }
  }
  const blocked = error === "signer_started" || error === "not_correctable";
  return (
    <Dialog
      title={t("operations.mnda.correct.title")}
      description={t("operations.mnda.correct.description", {
        name: record.input.signerName,
      })}
      trigger={trigger}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setEmail(mndaSignerEmail(record));
          setError(null);
        }
      }}
      closeLabel={t("common.cancel")}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(false);
              onSendToSomeoneElse();
            }}
          >
            {t("operations.mnda.correct.someoneElse")}
          </Button>
          <Button
            loading={busy}
            disabled={blocked}
            loadingLabel={t("operations.mnda.correct.working")}
            onClick={() => void save()}
          >
            {t("operations.mnda.correct.confirm")}
          </Button>
        </>
      }
    >
      <Input
        id={fieldId}
        type="email"
        label={t("operations.mnda.signerEmail")}
        value={email}
        maxLength={254}
        required
        help={t("operations.mnda.correct.help")}
        {...(error ? { error: t(mndaErrorLabels[error]) } : {})}
        onChange={(e) => {
          setEmail(e.target.value);
          setError(null);
        }}
      />
      {error === "session_expired" ? (
        <SessionExpiredReload onReloaded={() => setError(null)} />
      ) : null}
    </Dialog>
  );
}
