"use client";

import { useId, useState, useTransition } from "react";

import { Button, Dialog, Input, Select, Textarea } from "@clockwork/ui";

import styles from "../finance-lifecycle/finance-lifecycle.module.css";
import { classifyReconciliationVariance } from "./actions";
import { reconciliationCopy } from "./copy";
import {
  varianceClassificationLabels,
  varianceClassifications,
  type VarianceClassification,
} from "./model";

const { decision, failures, fallbackFailure } = reconciliationCopy;

export function VarianceDisposition({
  caseId,
  expectedRowVersion,
  subject,
  disabled = false,
}: {
  caseId: string;
  expectedRowVersion: number;
  subject: string;
  disabled?: boolean;
}) {
  const fieldId = useId().replaceAll(":", "");
  const [classification, setClassification] =
    useState<VarianceClassification>("delivery_timing");
  const [reason, setReason] = useState("");
  const [clearingPeriod, setClearingPeriod] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (reason.trim().length < 8) {
      setMessage(failures.RECONCILIATION_REASON_REQUIRED ?? "");
      return;
    }
    const formData = new FormData();
    formData.set("caseId", caseId);
    formData.set("expectedRowVersion", String(expectedRowVersion));
    formData.set("classification", classification);
    formData.set("reason", reason.trim());
    formData.set("expectedClearingPeriod", clearingPeriod.trim());
    formData.set("evidenceReference", evidenceReference.trim());
    startTransition(async () => {
      const result = await classifyReconciliationVariance(formData);
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
      title={`${decision.title}: ${subject}`}
      description={decision.description}
      trigger={
        <Button variant="secondary" size="small" disabled={disabled}>
          {decision.trigger}
        </Button>
      }
      footer={
        <Button
          variant="primary"
          size="small"
          onClick={submit}
          disabled={pending}
        >
          {pending ? decision.submitting : decision.confirm}
        </Button>
      }
    >
      <dl className={styles.reviewGrid}>
        <div>
          <dt>{decision.caseTerm}</dt>
          <dd>{subject}</dd>
        </div>
        <div>
          <dt>{decision.effectTerm}</dt>
          <dd>{decision.effectDetail}</dd>
        </div>
      </dl>
      <Select
        id={`${fieldId}-classification`}
        label={decision.classificationLabel}
        name="classification"
        value={classification}
        onChange={(event) => {
          setClassification(
            event.currentTarget.value as VarianceClassification,
          );
          if (message) setMessage("");
        }}
        options={varianceClassifications.map((value) => ({
          value,
          label: varianceClassificationLabels[value],
        }))}
      />
      <Input
        id={`${fieldId}-clearing`}
        label={decision.clearingLabel}
        name="expectedClearingPeriod"
        value={clearingPeriod}
        onChange={(event) => {
          setClearingPeriod(event.currentTarget.value);
          if (message) setMessage("");
        }}
        help={decision.clearingHelp}
      />
      <Input
        id={`${fieldId}-evidence`}
        label={decision.evidenceLabel}
        name="evidenceReference"
        value={evidenceReference}
        onChange={(event) => {
          setEvidenceReference(event.currentTarget.value);
          if (message) setMessage("");
        }}
        help={decision.evidenceHelp}
      />
      <Textarea
        id={`${fieldId}-reason`}
        label={decision.reasonLabel}
        name="reason"
        value={reason}
        onChange={(event) => {
          setReason(event.currentTarget.value);
          if (message) setMessage("");
        }}
        help={decision.reasonHelp}
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
          {decision.recorded}
        </p>
      ) : null}
    </Dialog>
  );
}
