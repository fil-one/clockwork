"use client";

import { useId, useState, useTransition } from "react";

import { Button, Dialog, Input, Textarea } from "@clockwork/ui";

import styles from "../finance-lifecycle/finance-lifecycle.module.css";
import { decideUnhandledError } from "./actions";
import { unhandledErrorsCopy } from "./copy";
import {
  containmentReferenceLimit,
  decisionReasonLimits,
  isContainmentReference,
  type IncidentDecision,
} from "./model";

const {
  decision: decisionCopy,
  failures,
  fallbackFailure,
} = unhandledErrorsCopy;

export function IncidentDecisionControl({
  decision,
  auditEventId,
  label,
  disabled = false,
}: {
  decision: IncidentDecision;
  auditEventId: string;
  /** Human name of the failure, used in the dialog title. */
  label: string;
  disabled?: boolean;
}) {
  const reasonId = useId().replaceAll(":", "");
  const evidenceId = `${reasonId}-evidence`;
  const [reason, setReason] = useState("");
  const [containmentReference, setContainmentReference] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const consequence = decisionCopy.consequences[decision] ?? "";

  function submit() {
    const trimmedReason = reason.trim();
    const trimmedReference = containmentReference.trim();
    // The same three checks the server action makes, each reported with its own
    // message. A single "too short" message covering a too-long reason is how
    // an operator is told the opposite of what is wrong.
    if (trimmedReason.length < decisionReasonLimits.min) {
      setMessage(failures.UNHANDLED_ERROR_REASON_REQUIRED ?? "");
      return;
    }
    if (trimmedReason.length > decisionReasonLimits.max) {
      setMessage(failures.UNHANDLED_ERROR_REASON_TOO_LONG ?? "");
      return;
    }
    if (trimmedReference && !isContainmentReference(trimmedReference)) {
      setMessage(failures.UNHANDLED_ERROR_EVIDENCE_INVALID ?? "");
      return;
    }
    const formData = new FormData();
    formData.set("auditEventId", auditEventId);
    formData.set("decision", decision);
    formData.set("reason", trimmedReason);
    formData.set("containmentReference", trimmedReference);
    startTransition(async () => {
      const result = await decideUnhandledError(formData);
      if (result.ok) {
        setDone(true);
        setMessage("");
        return;
      }
      setDone(false);
      setMessage(
        (result.code ? failures[result.code] : undefined) ?? fallbackFailure,
      );
    });
  }

  return (
    <Dialog
      title={`${decisionCopy.labels[decision]?.trigger ?? ""} ${label}`}
      description={consequence}
      trigger={
        <Button variant="secondary" size="small" disabled={disabled}>
          {decisionCopy.labels[decision]?.trigger}
        </Button>
      }
      footer={
        <Button
          variant="primary"
          size="small"
          onClick={submit}
          disabled={pending}
        >
          {pending
            ? decisionCopy.submitting
            : decisionCopy.labels[decision]?.confirm}
        </Button>
      }
    >
      <dl className={styles.reviewGrid}>
        <div>
          <dt>{decisionCopy.anchorTerm}</dt>
          <dd>{decisionCopy.anchorDetail}</dd>
        </div>
        <div>
          <dt>{decisionCopy.effectTerm}</dt>
          <dd>{consequence}</dd>
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
        help={decisionCopy.reasonHelp(
          decisionReasonLimits.min,
          decisionReasonLimits.max,
        )}
        rows={3}
        required
      />
      <Input
        id={evidenceId}
        label={decisionCopy.evidenceTerm}
        name="containmentReference"
        value={containmentReference}
        onChange={(event) => {
          setContainmentReference(event.currentTarget.value);
          if (message) setMessage("");
        }}
        help={decisionCopy.evidenceHelp(containmentReferenceLimit)}
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
