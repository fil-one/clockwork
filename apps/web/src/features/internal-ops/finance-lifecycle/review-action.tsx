"use client";
import { useTranslations } from "@/src/i18n/client";
import { localizeCopy } from "@/src/i18n/copy";

import { useEffect, useId, useState } from "react";

import { Button, Dialog, Textarea } from "@clockwork/ui";

import { lifecycleCopy } from "./copy";
import { buildReviewSummary, type ReviewSummary } from "./lifecycle-logic";
import styles from "./finance-lifecycle.module.css";

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
  const localizedlifecycleCopy = localizeCopy(lifecycleCopy, t);
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
    } catch (caught) {
      setReviewed(false);
      setError(
        caught instanceof Error
          ? caught.message
          : "A decision reason is required.",
      );
    }
  }

  return (
    <Dialog
      title={`${localizedlifecycleCopy.review.dialogPrefix} ${summary.action}`}
      description={localizedlifecycleCopy.review.dialogDescription}
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
          <dt>Affected entity</dt>
          <dd>{summary.entity}</dd>
        </div>
        <div>
          <dt>Impact</dt>
          <dd>{summary.impact}</dd>
        </div>
        <div>
          <dt>{t("ui.116")}</dt>
          <dd>{summary.evidence}</dd>
        </div>
        <div>
          <dt>Policy basis</dt>
          <dd>{summary.policyBasis}</dd>
        </div>
        <div>
          <dt>Downstream effect</dt>
          <dd>{summary.downstreamEffect}</dd>
        </div>
        <div>
          <dt>Actor authority</dt>
          <dd>{summary.actorAuthority}</dd>
        </div>
      </dl>
      <details className={styles.disclosure}>
        <summary>Technical evidence</summary>
        <p className={styles.id}>{summary.technicalId}</p>
      </details>
      <Textarea
        id={reasonId}
        label="Decision reason"
        name="decisionReason"
        value={reason}
        onChange={(event) => {
          setReason(event.currentTarget.value);
          if (error) setError("");
          if (reviewed) setReviewed(false);
        }}
        error={error || undefined}
        help="Required. This reason is retained with actor attribution and the review evidence."
        rows={3}
        required
      />
      <p className={styles.actorNote}>
        {localizedlifecycleCopy.review.actorNote}
      </p>
      <div className={styles.reviewHandoff} role="note">
        <strong>Review only</strong>
        <span>
          Nothing is applied here. Continue through the server-authorized
          workflow to apply the action and revalidate every gate.
        </span>
      </div>
      {reviewed ? (
        <p className={styles.statusMessage} role="status">
          {localizedlifecycleCopy.review.complete}
        </p>
      ) : null}
    </Dialog>
  );
}
