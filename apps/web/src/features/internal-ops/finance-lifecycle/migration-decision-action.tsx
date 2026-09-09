"use client";
import { useTranslations } from "@/src/i18n/client";

import { useActionState, useId } from "react";

import { Button, Dialog, Textarea } from "@clockwork/ui";

import {
  recordDemoMigrationDecision,
  type MigrationDecisionState,
} from "./migration-actions";
import type { ReviewSummary } from "./lifecycle-logic";
import styles from "./finance-lifecycle.module.css";

const initialState: MigrationDecisionState = { ok: false };

const errors: Readonly<Record<string, string>> = {
  MIGRATION_REASON_REQUIRED: "Give a decision reason of at least 8 characters.",
  MIGRATION_RECENT_AUTH_REQUIRED:
    "Sign in again to confirm this migration decision.",
  MIGRATION_FORBIDDEN: "Your migration authority has changed.",
  MIGRATION_RECORD_NOT_FOUND: "This migration record is no longer available.",
  MIGRATION_DECISION_INVALID:
    "The selected account no longer matches this migration record.",
  MIGRATION_DECISION_UNAVAILABLE:
    "Migration decisions are unavailable outside the guided demo.",
  MIGRATION_DECISION_FAILED:
    "The migration decision could not be recorded. Nothing changed.",
};

export function MigrationDecisionAction({
  migrationId,
  targetAccountId,
  triggerLabel,
  summary,
}: {
  migrationId: string;
  targetAccountId: string;
  triggerLabel: string;
  summary: ReviewSummary;
}) {
  const t = useTranslations();
  const formId = useId().replaceAll(":", "");
  const [state, action, pending] = useActionState(
    recordDemoMigrationDecision,
    initialState,
  );
  return (
    <Dialog
      title={`Review · ${summary.action}`}
      description="Confirm the exact migration target and retain a reason with the operator decision."
      trigger={
        <Button variant="secondary" size="small">
          {triggerLabel}
        </Button>
      }
      footer={
        <Button
          form={formId}
          type="submit"
          variant="primary"
          size="small"
          disabled={pending || state.ok}
        >
          {pending ? "Recording…" : state.ok ? "Recorded" : "Record decision"}
        </Button>
      }
    >
      <form action={action} id={formId}>
        <input type="hidden" name="migrationId" value={migrationId} />
        <input type="hidden" name="targetAccountId" value={targetAccountId} />
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
            <dt>Downstream effect</dt>
            <dd>{summary.downstreamEffect}</dd>
          </div>
        </dl>
        <Textarea
          label="Decision reason"
          name="reason"
          minLength={8}
          maxLength={500}
          required
          rows={3}
          help="Required. Retained with the authenticated operator and selected account."
        />
        {state.code ? (
          <p className={styles.statusMessage} role="alert">
            {errors[state.code] ?? errors.MIGRATION_DECISION_FAILED}
          </p>
        ) : null}
        {state.ok ? (
          <p className={styles.statusMessage} role="status">
            Migration decision recorded.
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
