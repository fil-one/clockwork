"use client";

import { useId, useState, useTransition } from "react";

import { Button, Dialog, Input, Textarea } from "@clockwork/ui";

import { useTranslations } from "@/src/i18n/client";

import styles from "../finance-lifecycle/finance-lifecycle.module.css";
import { decideUnhandledError } from "./actions";
import {
  containmentReferenceHelp,
  incidentDecisionLabels,
  incidentFailureMessage,
  incidentReasonHelp,
} from "./copy";
import {
  decisionReasonLimits,
  isContainmentReference,
  type IncidentDecision,
} from "./model";

export function IncidentDecisionControl({
  decision,
  auditEventId,
  label,
  disabled = false,
}: {
  decision: IncidentDecision;
  auditEventId: string;
  /** Name of the failure (its code or event type), used in the dialog title. */
  label: string;
  disabled?: boolean;
}) {
  const t = useTranslations();
  const reasonId = useId().replaceAll(":", "");
  const evidenceId = `${reasonId}-evidence`;
  const [reason, setReason] = useState("");
  const [containmentReference, setContainmentReference] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const labels = incidentDecisionLabels[decision];
  const consequence = t(labels.consequence);

  function submit() {
    const trimmedReason = reason.trim();
    const trimmedReference = containmentReference.trim();
    // The same three checks the server action makes, each reported with its own
    // message. A single "too short" message covering a too-long reason is how
    // an operator is told the opposite of what is wrong.
    if (trimmedReason.length < decisionReasonLimits.min) {
      setMessage(incidentFailureMessage("UNHANDLED_ERROR_REASON_REQUIRED", t));
      return;
    }
    if (trimmedReason.length > decisionReasonLimits.max) {
      setMessage(incidentFailureMessage("UNHANDLED_ERROR_REASON_TOO_LONG", t));
      return;
    }
    if (trimmedReference && !isContainmentReference(trimmedReference)) {
      setMessage(incidentFailureMessage("UNHANDLED_ERROR_EVIDENCE_INVALID", t));
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
      setMessage(incidentFailureMessage(result.code, t));
    });
  }

  return (
    <Dialog
      title={t(labels.title, { failure: label })}
      description={consequence}
      trigger={
        <Button variant="secondary" size="small" disabled={disabled}>
          {t(labels.trigger)}
        </Button>
      }
      footer={
        <Button
          variant="primary"
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
          <dt>{t("operations.incidents.decision.anchor")}</dt>
          <dd>{t("operations.incidents.decision.anchor.detail")}</dd>
        </div>
        <div>
          <dt>{t("operations.decision.effect")}</dt>
          <dd>{consequence}</dd>
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
        help={incidentReasonHelp(t)}
        rows={3}
        required
      />
      <Input
        id={evidenceId}
        label={t("operations.incidents.decision.reference")}
        name="containmentReference"
        value={containmentReference}
        onChange={(event) => {
          setContainmentReference(event.currentTarget.value);
          if (message) setMessage("");
        }}
        help={containmentReferenceHelp(t)}
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
