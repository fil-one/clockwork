"use client";

import { Button, Dialog, Textarea } from "@clockwork/ui";
import { useId, useState, useTransition } from "react";

import type { DeadLetterSource } from "@clockwork/db";

import { useTranslations } from "@/src/i18n/client";

import { decideDeadLetterOperation } from "./actions";
import {
  decisionConsequences,
  decisionLabels,
  decisionReversibility,
  recoveryFailureMessage,
  recoveryReasonMinimum,
} from "./copy";
import styles from "../finance-lifecycle/finance-lifecycle.module.css";

type Decision = "retry" | "abandon";

export function RecoveryDecision({
  decision,
  source,
  id,
  reference,
  subject,
  disabled = false,
}: {
  decision: Decision;
  source: DeadLetterSource;
  id: string;
  reference: string;
  /** What the work acts on, already worded for the reader. */
  subject: string;
  disabled?: boolean;
}) {
  const t = useTranslations();
  const reasonId = useId().replaceAll(":", "");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const consequence = t(decisionConsequences[decision][source]);
  const labels = decisionLabels[decision];

  function submit() {
    if (reason.trim().length < recoveryReasonMinimum) {
      setMessage(recoveryFailureMessage("SYSTEM_RECOVERY_REASON_REQUIRED", t));
      return;
    }
    const formData = new FormData();
    formData.set("source", source);
    formData.set("id", id);
    formData.set("action", decision);
    formData.set("reason", reason.trim());
    startTransition(async () => {
      const result = await decideDeadLetterOperation(formData);
      if (result.ok && !result.code) {
        setDone(true);
        setMessage("");
        return;
      }
      setDone(Boolean(result.ok));
      setMessage(recoveryFailureMessage(result.code, t));
    });
  }

  return (
    <Dialog
      closeLabel={t("common.close")}
      title={t(labels.title, { reference })}
      description={consequence}
      trigger={
        <Button variant="secondary" size="small" disabled={disabled}>
          {t(labels.trigger)}
        </Button>
      }
      footer={
        <Button
          variant={decision === "abandon" ? "danger" : "primary"}
          size="small"
          onClick={submit}
          disabled={pending}
        >
          {pending ? t("operations.decision.recording") : t(labels.confirm)}
        </Button>
      }
    >
      <dl className={styles.reviewGrid}>
        <div>
          <dt>{t("operations.recovery.column.record")}</dt>
          <dd>{subject}</dd>
        </div>
        <div>
          <dt>{t("operations.decision.effect")}</dt>
          <dd>{consequence}</dd>
        </div>
        <div>
          <dt>{t("operations.recovery.decision.reversible")}</dt>
          <dd>{t(decisionReversibility[decision][source])}</dd>
        </div>
      </dl>
      <Textarea
        id={reasonId}
        label={t("operations.decision.reason")}
        name="reason"
        value={reason}
        onChange={(event) => {
          setReason(event.currentTarget.value);
          if (message) setMessage("");
        }}
        help={t("operations.recovery.decision.reasonHelp", {
          min: recoveryReasonMinimum,
        })}
        rows={3}
        required
      />
      {message ? (
        <p className={styles.statusMessage} role="alert">
          {message}
        </p>
      ) : null}
      {done && !message ? (
        <p className={styles.statusMessage} role="status">
          {t("operations.decision.recorded")}
        </p>
      ) : null}
    </Dialog>
  );
}
