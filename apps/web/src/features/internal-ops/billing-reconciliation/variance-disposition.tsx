"use client";
import { useTranslations } from "@/src/i18n/client";

import { useId, useState, useTransition } from "react";

import { Button, Dialog, Input, Select, Textarea } from "@clockwork/ui";

import styles from "../finance-lifecycle/finance-lifecycle.module.css";
import { classifyReconciliationVariance } from "./actions";
import { reconciliationCopy } from "./copy";
import { varianceClassifications, type VarianceClassification } from "./model";

const { decision, failures, fallbackFailure, classifications } =
  reconciliationCopy;

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
  const t = useTranslations();
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
      setMessage(t(failures.RECONCILIATION_REASON_REQUIRED ?? fallbackFailure));
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
        t((result.code ? failures[result.code] : undefined) ?? fallbackFailure),
      );
    });
  }

  return (
    <Dialog
      title={t(decision.title, { subject })}
      description={t(decision.description)}
      trigger={
        <Button variant="secondary" size="small" disabled={disabled}>
          {t(decision.trigger)}
        </Button>
      }
      footer={
        <Button
          variant="primary"
          size="small"
          onClick={submit}
          disabled={pending}
        >
          {pending ? t(decision.submitting) : t(decision.confirm)}
        </Button>
      }
    >
      <dl className={styles.reviewGrid}>
        <div>
          <dt>{t(decision.caseTerm)}</dt>
          <dd>{subject}</dd>
        </div>
        <div>
          <dt>{t(decision.effectTerm)}</dt>
          <dd>{t(decision.effectDetail)}</dd>
        </div>
      </dl>
      <Select
        id={`${fieldId}-classification`}
        label={t(decision.classificationLabel)}
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
          label: t(classifications[value]),
        }))}
      />
      <Input
        id={`${fieldId}-clearing`}
        label={t(decision.clearingLabel)}
        name="expectedClearingPeriod"
        value={clearingPeriod}
        onChange={(event) => {
          setClearingPeriod(event.currentTarget.value);
          if (message) setMessage("");
        }}
        help={t(decision.clearingHelp)}
      />
      <Input
        id={`${fieldId}-evidence`}
        label={t(decision.evidenceLabel)}
        name="evidenceReference"
        value={evidenceReference}
        onChange={(event) => {
          setEvidenceReference(event.currentTarget.value);
          if (message) setMessage("");
        }}
        help={t(decision.evidenceHelp)}
      />
      <Textarea
        id={`${fieldId}-reason`}
        label={t(decision.reasonLabel)}
        name="reason"
        value={reason}
        onChange={(event) => {
          setReason(event.currentTarget.value);
          if (message) setMessage("");
        }}
        help={t(decision.reasonHelp)}
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
          {t(decision.recorded)}
        </p>
      ) : null}
    </Dialog>
  );
}
