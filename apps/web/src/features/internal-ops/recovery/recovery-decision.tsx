"use client";

import { Button, Dialog, Textarea } from "@clockwork/ui";
import { useId, useState, useTransition } from "react";

import type { DeadLetterSource } from "@clockwork/db";

import { decideDeadLetterOperation } from "./actions";
import {
  decisionConsequences,
  decisionReversibility,
  recoveryCopy,
} from "./copy";
import styles from "../finance-lifecycle/finance-lifecycle.module.css";

type Decision = "retry" | "abandon";

const { decision: decisionCopy, failures, fallbackFailure } = recoveryCopy;

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
  subject: string;
  disabled?: boolean;
}) {
  const reasonId = useId().replaceAll(":", "");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const consequence = decisionConsequences[decision][source];

  function submit() {
    if (reason.trim().length < 8) {
      setMessage(failures.SYSTEM_RECOVERY_REASON_REQUIRED ?? "");
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
      setMessage(
        (result.code ? failures[result.code] : undefined) ?? fallbackFailure,
      );
    });
  }

  return (
    <Dialog
      title={`${decisionCopy.labels[decision].trigger} ${reference}`}
      description={consequence}
      trigger={
        <Button variant="secondary" size="small" disabled={disabled}>
          {decisionCopy.labels[decision].trigger}
        </Button>
      }
      footer={
        <Button
          variant={decision === "abandon" ? "danger" : "primary"}
          size="small"
          onClick={submit}
          disabled={pending}
        >
          {pending
            ? decisionCopy.submitting
            : decisionCopy.labels[decision].confirm}
        </Button>
      }
    >
      <dl className={styles.reviewGrid}>
        <div>
          <dt>{decisionCopy.recordTerm}</dt>
          <dd>{subject}</dd>
        </div>
        <div>
          <dt>{decisionCopy.effectTerm}</dt>
          <dd>{consequence}</dd>
        </div>
        <div>
          <dt>{decisionCopy.reversibleTerm}</dt>
          <dd>{decisionReversibility[decision][source]}</dd>
        </div>
      </dl>
      <Textarea
        id={reasonId}
        label={decisionCopy.reasonLabel}
        name="reason"
        value={reason}
        onChange={(event) => {
          setReason(event.currentTarget.value);
          if (message) setMessage("");
        }}
        help={decisionCopy.reasonHelp}
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
          {decisionCopy.recorded}
        </p>
      ) : null}
    </Dialog>
  );
}
