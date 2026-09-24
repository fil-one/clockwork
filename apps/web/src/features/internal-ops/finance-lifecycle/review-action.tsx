"use client";
import { useTranslations } from "@/src/i18n/client";

import { useEffect, useId, useState } from "react";

import { Button, Dialog, Textarea } from "@clockwork/ui";

import { lifecycleCopy } from "./copy";
import { buildReviewSummary, type ReviewSummary } from "./lifecycle-logic";
import styles from "./finance-lifecycle.module.css";

const copy = lifecycleCopy.review;

export function ReviewAction({
  triggerLabel,
  confirmLabel,
  summary,
  disabled = false,
}: {
  triggerLabel: string;
  confirmLabel: string;
  summary: ReviewSummary;
  disabled?: boolean;
}) {
  const t = useTranslations();
  const reasonId = useId().replaceAll(":", "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [reviewed, setReviewed] = useState(false);

  useEffect(() => {
    if (error) document.getElementById(reasonId)?.focus();
  }, [error, reasonId]);

  function confirmReview() {
    try {
      buildReviewSummary(summary, reason);
      setError("");
      setReviewed(true);
    } catch {
      // The only refusal is a blank reason; say so in the reader's language
      // rather than surfacing the thrown code.
      setReviewed(false);
      setError(t(copy.reasonRequired));
    }
  }

  return (
    <Dialog
      title={t(copy.dialogTitle, { action: summary.action })}
      description={t(copy.dialogDescription)}
      trigger={
        <Button variant="secondary" size="small" disabled={disabled}>
          {triggerLabel}
        </Button>
      }
      footer={
        <Button variant="primary" size="small" onClick={confirmReview}>
          {confirmLabel}
        </Button>
      }
    >
      <dl className={styles.reviewGrid}>
        <div>
          <dt>{t(copy.terms.entity)}</dt>
          <dd>{summary.entity}</dd>
        </div>
        <div>
          <dt>{t(copy.terms.impact)}</dt>
          <dd>{summary.impact}</dd>
        </div>
        <div>
          <dt>{t(copy.terms.evidence)}</dt>
          <dd>{summary.evidence}</dd>
        </div>
        <div>
          <dt>{t(copy.terms.policy)}</dt>
          <dd>{summary.policyBasis}</dd>
        </div>
        <div>
          <dt>{t(copy.terms.downstream)}</dt>
          <dd>{summary.downstreamEffect}</dd>
        </div>
        <div>
          <dt>{t(copy.terms.authority)}</dt>
          <dd>{summary.actorAuthority}</dd>
        </div>
      </dl>
      <details className={styles.disclosure}>
        <summary>{t(lifecycleCopy.evidence.technical)}</summary>
        <p className={styles.id}>{summary.technicalId}</p>
      </details>
      <Textarea
        id={reasonId}
        label={t(copy.reasonLabel)}
        name="decisionReason"
        value={reason}
        onChange={(event) => {
          setReason(event.currentTarget.value);
          if (error) setError("");
          if (reviewed) setReviewed(false);
        }}
        error={error || undefined}
        help={t(copy.reasonHelp)}
        rows={3}
        required
      />
      <p className={styles.actorNote}>{t(copy.actorNote)}</p>
      <div className={styles.reviewHandoff} role="note">
        <strong>{t(copy.handoffTitle)}</strong>
        <span>{t(copy.handoffBody)}</span>
      </div>
      {reviewed ? (
        <p className={styles.statusMessage} role="status">
          {t(copy.complete)}
        </p>
      ) : null}
    </Dialog>
  );
}
