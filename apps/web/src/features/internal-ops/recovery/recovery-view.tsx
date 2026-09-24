import { use } from "react";

import { StatusBadge, Table } from "@clockwork/ui";

import type { MessageId, Translator } from "@/src/i18n";
import { richText } from "@/src/i18n/rich";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { SurfaceActionGate } from "@/src/features/shell/permission-gate";

import { FinancePageFrame } from "../finance-lifecycle/page-frame";
import styles from "../finance-lifecycle/finance-lifecycle.module.css";
import { recoverySourceLabels, sourceLabels } from "./copy";
import type {
  DeadLetterOperation,
  DeadLetterResult,
} from "./dead-letter-loader";
import { MachineCode } from "../machine-code";
import { RecoveryDecision } from "./recovery-decision";

/** What the stopped work acts on, named the way the rest of the product names it. */
const subjectKinds: Readonly<Record<string, MessageId>> = {
  account: "recordKind.account",
  agreement: "recordKind.agreement",
  amendment: "recordKind.amendment",
  invoice: "recordKind.invoice",
  order: "recordKind.order",
  payment: "recordKind.payment",
  quote: "recordKind.quote",
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * A UUID is shortened to its first block, which is how operators quote one. A
 * readable reference is shown whole: cutting `INV-2026-0781` to eight
 * characters left `INV-2026`, a different-looking reference.
 */
export function shortIdentifier(value: string): string {
  return uuid.test(value) ? value.slice(0, 8) : value;
}

function elapsed(
  failedAt: string,
  now: Date,
  t: Translator,
  locale: string,
): string {
  const hours = Math.floor(
    (now.getTime() - Date.parse(failedAt)) / (60 * 60_000),
  );
  if (!Number.isFinite(hours) || hours < 1)
    return t("operations.recovery.waiting.underAnHour");
  const unit = hours < 24 ? "hour" : "day";
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay: "long",
  }).format(unit === "hour" ? hours : Math.floor(hours / 24));
}

function subjectKind(operation: DeadLetterOperation, t: Translator): string {
  const kind = Object.hasOwn(subjectKinds, operation.subjectType)
    ? subjectKinds[operation.subjectType]
    : undefined;
  return kind ? t(kind) : operation.subjectType;
}

export function recoverySubject(
  operation: DeadLetterOperation,
  t: Translator,
): string {
  return t("operations.recovery.subject", {
    kind: subjectKind(operation, t),
    reference: shortIdentifier(operation.subjectId),
  });
}

/** The same subject in the table, with the reference kept on one line. */
function RecoverySubjectCell({
  operation,
  t,
}: {
  operation: DeadLetterOperation;
  t: Translator;
}) {
  return richText(t, "operations.recovery.subject", {
    kind: subjectKind(operation, t),
    reference: (
      <bdi className={styles.reference}>
        {shortIdentifier(operation.subjectId)}
      </bdi>
    ),
  });
}

export function RecoveryView({
  result,
  now = new Date(),
}: {
  result: DeadLetterResult;
  now?: Date;
}) {
  const t = use(getTranslations());
  const locale = use(getFormattingLocale());
  const { operations, readable, source } = result;
  const bySource = (key: keyof typeof sourceLabels) =>
    operations.filter((operation) => operation.source === key).length;
  const awaitingRetry = operations.filter(
    (operation) => operation.decision === "retry_requested",
  ).length;
  const sourceLabel = t(recoverySourceLabels[source]);

  return (
    <FinancePageFrame
      title={t("operations.recovery.title")}
      description={t("operations.recovery.description")}
      provenance={
        readable
          ? { kind: "read", source: sourceLabel, readAt: now.toISOString() }
          : { kind: "unreadable", source: sourceLabel }
      }
    >
      <section
        className={styles.summaryGrid}
        aria-label={t("operations.recovery.summary.label")}
      >
        <article className={styles.summaryCard}>
          <p>{t("operations.recovery.engine.dispatch")}</p>
          <strong>{bySource("outbox_message")}</strong>
          <span>{t("operations.recovery.summary.dispatch")}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{t("operations.recovery.engine.provisioning")}</p>
          <strong>{bySource("provisioning_attempt")}</strong>
          <span>{t("operations.recovery.summary.provisioning")}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{t("operations.recovery.summary.workflow.title")}</p>
          <strong>{bySource("workflow_run")}</strong>
          <span>{t("operations.recovery.summary.workflow")}</span>
        </article>
      </section>

      {readable ? null : (
        <div className={styles.warningNotice} role="alert">
          <strong>{t("operations.recovery.unreadable.title")}</strong>
          <span>{t("operations.recovery.unreadable.detail")}</span>
        </div>
      )}

      {awaitingRetry > 0 ? (
        <div className={styles.notice} role="note">
          <strong>
            {t("operations.recovery.retrying.title", { count: awaitingRetry })}
          </strong>
          <span>{t("operations.recovery.retrying.detail")}</span>
        </div>
      ) : null}

      <section className={styles.section} aria-labelledby="stopped-work">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="stopped-work">{t("operations.recovery.title")}</h2>
            <p>{t("operations.recovery.table.subheading")}</p>
          </div>
          <span className={styles.sectionMeta}>
            {t("operations.records", { count: operations.length })}
          </span>
        </header>
        {operations.length === 0 && readable ? (
          <p className={styles.empty}>{t("operations.recovery.table.empty")}</p>
        ) : (
          <Table
            className={`${styles.dsTable ?? ""} ${styles.denseTable ?? ""}`}
            caption={t("operations.recovery.table.caption")}
            captionHidden
            density="compact"
            headers={[
              t("operations.recovery.column.engine"),
              t("operations.recovery.column.work"),
              t("operations.recovery.column.record"),
              t("operations.recovery.column.failure"),
              t("operations.column.attempts"),
              t("operations.recovery.column.waiting"),
              t("operations.column.decision"),
            ]}
            numericColumns={[4]}
            rowKeys={operations.map(
              (operation) => `${operation.source}-${operation.id}`,
            )}
            rows={operations.map((operation) => {
              const subject = recoverySubject(operation, t);
              return [
                t(sourceLabels[operation.source]),
                <div className={styles.primaryCell}>
                  <strong>
                    <MachineCode
                      className={styles.code}
                      value={operation.reference}
                    />
                  </strong>
                  <span className={`${styles.secondary} ${styles.code}`}>
                    {operation.id.slice(0, 8)}
                  </span>
                </div>,
                <RecoverySubjectCell operation={operation} t={t} />,
                <StatusBadge tone="danger">
                  {operation.failureCode}
                </StatusBadge>,
                <strong>{operation.attemptCount}</strong>,
                elapsed(operation.failedAt, now, t, locale),
                <div className={styles.actionStack}>
                  {operation.decision === "retry_requested" ? (
                    <span className={styles.waiting}>
                      {operation.decisionReason
                        ? t("operations.recovery.row.retryingWithReason", {
                            reason: operation.decisionReason,
                          })
                        : t("operations.recovery.row.retrying")}
                    </span>
                  ) : null}
                  <SurfaceActionGate
                    audience="internal"
                    requiredPermission="system:operate"
                  >
                    <RecoveryDecision
                      decision="retry"
                      source={operation.source}
                      id={operation.id}
                      reference={operation.reference}
                      subject={subject}
                    />
                    <RecoveryDecision
                      decision="abandon"
                      source={operation.source}
                      id={operation.id}
                      reference={operation.reference}
                      subject={subject}
                    />
                  </SurfaceActionGate>
                </div>,
              ];
            })}
          />
        )}
      </section>
    </FinancePageFrame>
  );
}
