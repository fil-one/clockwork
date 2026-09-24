"use client";
import type { MessageId } from "@/src/i18n";
import { useTranslations } from "@/src/i18n/client";

import { useActionState, useId } from "react";

import { Button, Dialog, Textarea } from "@clockwork/ui";

import { lifecycleCopy } from "./copy";
import {
  recordDemoMigrationDecision,
  type MigrationDecisionState,
} from "./migration-actions";
import type { ReviewSummary } from "./lifecycle-logic";
import styles from "./finance-lifecycle.module.css";

const initialState: MigrationDecisionState = { ok: false };

const copy = lifecycleCopy.review;

/** Every refusal code `recordDemoMigrationDecision` returns, worded. */
const errors: Readonly<Record<string, MessageId>> = {
  MIGRATION_REASON_REQUIRED: copy.errors.reasonRequired,
  MIGRATION_RECENT_AUTH_REQUIRED: copy.errors.recentAuth,
  MIGRATION_FORBIDDEN: copy.errors.forbidden,
  MIGRATION_RECORD_NOT_FOUND: copy.errors.notFound,
  MIGRATION_DECISION_INVALID: copy.errors.invalid,
  MIGRATION_DECISION_UNAVAILABLE: copy.errors.unavailable,
  MIGRATION_DECISION_FAILED: copy.errors.failed,
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
      title={t(copy.dialogTitle, { action: summary.action })}
      description={t(copy.decisionDescription)}
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
          {pending
            ? t(copy.recording)
            : state.ok
              ? t(copy.recorded)
              : t(copy.recordDecision)}
        </Button>
      }
    >
      <form action={action} id={formId}>
        <input type="hidden" name="migrationId" value={migrationId} />
        <input type="hidden" name="targetAccountId" value={targetAccountId} />
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
            <dt>{t(copy.terms.downstream)}</dt>
            <dd>{summary.downstreamEffect}</dd>
          </div>
        </dl>
        <Textarea
          label={t(copy.reasonLabel)}
          name="reason"
          minLength={8}
          maxLength={500}
          required
          rows={3}
          help={t(copy.decisionReasonHelp)}
        />
        {state.code ? (
          <p className={styles.statusMessage} role="alert">
            {t(errors[state.code] ?? copy.errors.failed)}
          </p>
        ) : null}
        {state.ok ? (
          <p className={styles.statusMessage} role="status">
            {t(copy.decisionRecorded)}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
