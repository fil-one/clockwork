import { Button, StatusBadge } from "@clockwork/ui";

import { lifecycleCopy } from "./copy";
import { provisioning, type FailureClass } from "./lifecycle-data";
import { assessRetry } from "./lifecycle-logic";
import { FinancePageFrame } from "./page-frame";
import { ReviewAction } from "./review-action";
import styles from "./finance-lifecycle.module.css";

function failureTone(failure: FailureClass): "neutral" | "warning" | "danger" {
  if (failure === "Permanent") return "danger";
  if (failure === "Transient") return "warning";
  return "neutral";
}

export function ProvisioningView() {
  const safeRetries = provisioning.filter(
    (record) => assessRetry(record).allowed,
  );
  const permanent = provisioning.filter(
    (record) => record.failureClass === "Permanent",
  );
  const idempotencyBlocked = provisioning.filter(
    (record) => record.idempotencyState === "Missing",
  );

  return (
    <FinancePageFrame
      title={lifecycleCopy.provisioning.title}
      description={lifecycleCopy.provisioning.description}
      freshness={lifecycleCopy.provisioning.freshness}
      source={lifecycleCopy.provisioning.source}
    >
      <section
        className={styles.summaryGrid}
        aria-label="Provisioning recovery state"
      >
        <article className={styles.summaryCard}>
          <p>Safe retry candidates</p>
          <strong>{safeRetries.length}</strong>
          <span>
            Transient with verified idempotency and attempts remaining
          </span>
        </article>
        <article className={styles.summaryCard}>
          <p>Permanent failures</p>
          <strong>{permanent.length}</strong>
          <span>Escalation required; automatic retry prohibited</span>
        </article>
        <article className={styles.summaryCard}>
          <p>Missing idempotency evidence</p>
          <strong>{idempotencyBlocked.length}</strong>
          <span>
            Retry blocked until duplicate-resource safety is established
          </span>
        </article>
      </section>

      <div className={styles.warningNotice} role="note">
        <strong>Retry safety is mandatory.</strong>
        <span>
          A transient label alone is not permission to retry. The orchestrator
          must also verify idempotency and attempt limits; provider activation
          tests remain authoritative.
        </span>
      </div>

      <section className={styles.section} aria-labelledby="recovery-table">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="recovery-table">Recovery work</h2>
            <p>
              Failure class, attempts, retry evidence, owner, and escalation.
            </p>
          </div>
          <span className={styles.sectionMeta}>
            {provisioning.length} operations · live provider state
          </span>
        </header>
        <div className={styles.tableScroll} tabIndex={0}>
          <table className={styles.table}>
            <caption className="sr-only">
              Provisioning operations with retry-safety decisions
            </caption>
            <thead>
              <tr>
                <th scope="col">Account / capability</th>
                <th scope="col">Provider</th>
                <th scope="col">Failure class</th>
                <th scope="col">Attempts</th>
                <th scope="col">Idempotency</th>
                <th scope="col">Owner / escalation</th>
                <th scope="col">Permitted action</th>
              </tr>
            </thead>
            <tbody>
              {provisioning.map((record) => {
                const assessment = assessRetry(record);
                const canEscalate = record.failureClass === "Permanent";
                return (
                  <tr key={record.id}>
                    <td>
                      <div className={styles.primaryCell}>
                        <strong>{record.account}</strong>
                        <span>{record.capability}</span>
                        <span className={styles.secondary}>{record.id}</span>
                      </div>
                    </td>
                    <td>{record.provider}</td>
                    <td>
                      <StatusBadge tone={failureTone(record.failureClass)}>
                        {record.failureClass}
                      </StatusBadge>
                      <div className={styles.secondary}>
                        {record.lastAttempt}
                      </div>
                    </td>
                    <td>
                      <strong>
                        {record.attempts} / {record.maxAttempts}
                      </strong>
                    </td>
                    <td>
                      <div className={styles.primaryCell}>
                        <strong>{record.idempotencyState}</strong>
                        <details className={styles.disclosure}>
                          <summary>Retry evidence</summary>
                          <p>{record.evidence}</p>
                          {record.idempotencyKey ? (
                            <p className={styles.id}>{record.idempotencyKey}</p>
                          ) : (
                            <p>No idempotency key is available.</p>
                          )}
                        </details>
                      </div>
                    </td>
                    <td>
                      <div className={styles.primaryCell}>
                        <strong>{record.owner}</strong>
                        <span>{record.escalation}</span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.actionStack}>
                        {assessment.allowed ? (
                          <ReviewAction
                            triggerLabel="Review safe retry"
                            confirmLabel="Complete retry review"
                            summary={{
                              action: "Stage safe provisioning retry",
                              entity: `${record.account} · ${record.capability}`,
                              impact: `A new provider attempt would be issued (${record.attempts + 1} of ${record.maxAttempts}).`,
                              evidence: assessment.reason,
                              policyBasis:
                                "Provisioning recovery §2.1 · transient + verified idempotency + remaining attempt",
                              downstreamEffect:
                                "Activation tests run before Clockwork presents the capability as active.",
                              technicalId: `${record.id} · ${record.idempotencyKey ?? "no key"}`,
                              actorAuthority:
                                "Internal operator permission is required; server actor and idempotency checks remain authoritative.",
                            }}
                          />
                        ) : canEscalate ? (
                          <ReviewAction
                            triggerLabel="Review escalation"
                            confirmLabel="Complete escalation review"
                            summary={{
                              action: "Escalate permanent provider failure",
                              entity: `${record.account} · ${record.capability}`,
                              impact:
                                "Provider and policy owners receive the blocked capability; no retry is sent.",
                              evidence: record.evidence,
                              policyBasis:
                                "Provisioning recovery §2.4 · permanent failures prohibit retry",
                              downstreamEffect:
                                "Capability remains unavailable until an activation test succeeds.",
                              technicalId: record.id,
                              actorAuthority:
                                "Internal operator may route evidence; provider and legal gates remain separate.",
                            }}
                          />
                        ) : (
                          <Button
                            variant="secondary"
                            size="small"
                            disabled
                            title={assessment.reason}
                          >
                            {assessment.label}
                          </Button>
                        )}
                        <span
                          className={
                            assessment.allowed
                              ? styles.safe
                              : record.failureClass === "Waiting"
                                ? styles.waiting
                                : styles.blocked
                          }
                        >
                          {assessment.reason}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </FinancePageFrame>
  );
}
