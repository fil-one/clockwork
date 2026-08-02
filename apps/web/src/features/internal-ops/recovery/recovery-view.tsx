import { StatusBadge } from "@clockwork/ui";

import { SurfaceActionGate } from "@/src/features/shell/permission-gate";

import { FinancePageFrame } from "../finance-lifecycle/page-frame";
import styles from "../finance-lifecycle/finance-lifecycle.module.css";
import { recoveryCopy, sourceLabels } from "./copy";
import type {
  DeadLetterOperation,
  DeadLetterResult,
} from "./dead-letter-loader";
import { RecoveryDecision } from "./recovery-decision";

const { page, summary, unreadable, retrying, table } = recoveryCopy;

function elapsed(failedAt: string, now: Date): string {
  const hours = Math.floor(
    (now.getTime() - Date.parse(failedAt)) / (60 * 60_000),
  );
  if (!Number.isFinite(hours) || hours < 1) return table.waitingUnderHour;
  if (hours < 24) return table.waitingHours(hours);
  return table.waitingDays(Math.floor(hours / 24));
}

function subject(operation: DeadLetterOperation): string {
  return `${operation.subjectType} ${operation.subjectId.slice(0, 8)}`;
}

export function RecoveryView({
  result,
  now = new Date(),
}: {
  result: DeadLetterResult;
  now?: Date;
}) {
  const { operations, readable, source } = result;
  const bySource = (key: keyof typeof sourceLabels) =>
    operations.filter((operation) => operation.source === key).length;
  const awaitingRetry = operations.filter(
    (operation) => operation.decision === "retry_requested",
  ).length;

  return (
    <FinancePageFrame
      title={page.title}
      description={page.description}
      freshness={readable ? page.freshnessRead : page.freshnessUnavailable}
      source={source}
    >
      <section className={styles.summaryGrid} aria-label={summary.label}>
        <article className={styles.summaryCard}>
          <p>{summary.dispatch.title}</p>
          <strong>{bySource("outbox_message")}</strong>
          <span>{summary.dispatch.detail}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{summary.provisioning.title}</p>
          <strong>{bySource("provisioning_attempt")}</strong>
          <span>{summary.provisioning.detail}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{summary.workflow.title}</p>
          <strong>{bySource("workflow_run")}</strong>
          <span>{summary.workflow.detail}</span>
        </article>
      </section>

      {readable ? null : (
        <div className={styles.warningNotice} role="alert">
          <strong>{unreadable.title}</strong>
          <span>{unreadable.detail}</span>
        </div>
      )}

      {awaitingRetry > 0 ? (
        <div className={styles.notice} role="note">
          <strong>{retrying.title(awaitingRetry)}</strong>
          <span>{retrying.detail}</span>
        </div>
      ) : null}

      <section className={styles.section} aria-labelledby="stopped-work">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="stopped-work">{table.heading}</h2>
            <p>{table.subheading}</p>
          </div>
          <span className={styles.sectionMeta}>
            {table.count(operations.length)}
          </span>
        </header>
        {operations.length === 0 && readable ? (
          <p className={styles.empty}>{table.empty}</p>
        ) : (
          <div className={styles.tableScroll} tabIndex={0}>
            <table className={styles.table}>
              <caption className="sr-only">{table.caption}</caption>
              <thead>
                <tr>
                  <th scope="col">{table.columns.engine}</th>
                  <th scope="col">{table.columns.work}</th>
                  <th scope="col">{table.columns.record}</th>
                  <th scope="col">{table.columns.failure}</th>
                  <th scope="col">{table.columns.attempts}</th>
                  <th scope="col">{table.columns.waiting}</th>
                  <th scope="col">{table.columns.decision}</th>
                </tr>
              </thead>
              <tbody>
                {operations.map((operation) => (
                  <tr key={`${operation.source}-${operation.id}`}>
                    <td>{sourceLabels[operation.source]}</td>
                    <td>
                      <div className={styles.primaryCell}>
                        <strong>{operation.reference}</strong>
                        <span className={styles.secondary}>
                          {operation.id.slice(0, 8)}
                        </span>
                      </div>
                    </td>
                    <td>{subject(operation)}</td>
                    <td>
                      <StatusBadge tone="danger">
                        {operation.failureCode}
                      </StatusBadge>
                    </td>
                    <td>
                      <strong>{operation.attemptCount}</strong>
                    </td>
                    <td>{elapsed(operation.failedAt, now)}</td>
                    <td>
                      <div className={styles.actionStack}>
                        {operation.decision === "retry_requested" ? (
                          <span className={styles.waiting}>
                            {table.retryingCell(operation.decisionReason)}
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
                            subject={subject(operation)}
                          />
                          <RecoveryDecision
                            decision="abandon"
                            source={operation.source}
                            id={operation.id}
                            reference={operation.reference}
                            subject={subject(operation)}
                          />
                        </SurfaceActionGate>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </FinancePageFrame>
  );
}
