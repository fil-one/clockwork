import Link from "next/link";

import {
  actionSignals,
  internalOpsCopy,
  monitoringSignals,
  type OperationalSignal,
} from "../copy";
import styles from "./operations-home.module.css";

function SignalCard({ signal }: { signal: OperationalSignal }) {
  return (
    <article className={styles.signal} data-tone={signal.tone}>
      <div className={styles.signalHeading}>
        <div>
          <p className={styles.label}>{signal.label}</p>
          <strong className={styles.value}>{signal.value}</strong>
        </div>
        {signal.truth ? (
          <span className={styles.truth}>{signal.truth}</span>
        ) : null}
      </div>
      <p className={styles.detail}>{signal.detail}</p>
      <dl className={styles.metadata}>
        <div>
          <dt>{internalOpsCopy.home.owner}</dt>
          <dd>{signal.owner}</dd>
        </div>
        <div>
          <dt>{internalOpsCopy.home.fresh}</dt>
          <dd>
            <time dateTime={signal.observedAt}>{signal.freshness}</time>
          </dd>
        </div>
      </dl>
      <Link className={styles.cardLink} href={signal.href}>
        {signal.action}
        <span aria-hidden="true"> →</span>
      </Link>
    </article>
  );
}

export function OperationsHome() {
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{internalOpsCopy.home.eyebrow}</p>
          <h1>{internalOpsCopy.home.title}</h1>
          <p className={styles.description}>
            {internalOpsCopy.home.description}
          </p>
        </div>
        <p className={styles.freshness} role="status">
          <span aria-hidden="true" />
          {internalOpsCopy.home.refreshed}
        </p>
      </header>

      <section aria-labelledby="recommended-actions-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Priority order</p>
            <h2 id="recommended-actions-title">
              {internalOpsCopy.home.actionHeading}
            </h2>
            <p>{internalOpsCopy.home.actionDescription}</p>
          </div>
          <Link
            className={styles.primaryLink}
            href="/internal/queues?view=assigned-to-me&sort=priority&page=1&pageSize=25"
          >
            Open my queue
          </Link>
        </div>
        <ol className={styles.recommendations}>
          <li>
            <span className={styles.rank}>1</span>
            <div>
              <strong>Recover two customer activations before 14:00 ET</strong>
              <p>
                Retries are idempotent and classified transient; confirm
                evidence first.
              </p>
            </div>
            <Link href="/internal/provisioning">Review 2 retries</Link>
          </li>
          <li>
            <span className={styles.rank}>2</span>
            <div>
              <strong>Assign backups to four breached cases</strong>
              <p>High-risk queue work is within 24 minutes of escalation.</p>
            </div>
            <Link href="/internal/queues?view=awaiting-backup&sort=priority&page=1&pageSize=25">
              Assign owners
            </Link>
          </li>
          <li>
            <span className={styles.rank}>3</span>
            <div>
              <strong>Resolve disputed invoice ownership</strong>
              <p>
                $74,200 is overdue and cannot advance until the dispute owner
                responds.
              </p>
            </div>
            <Link href="/internal/collections">Open collections</Link>
          </li>
        </ol>
      </section>

      <section aria-labelledby="action-health-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Attention needed</p>
            <h2 id="action-health-title">
              {internalOpsCopy.home.healthHeading}
            </h2>
          </div>
        </div>
        <div className={styles.grid}>
          {actionSignals.map((signal) => (
            <SignalCard key={signal.label} signal={signal} />
          ))}
        </div>
      </section>

      <section aria-labelledby="monitoring-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>No action required</p>
            <h2 id="monitoring-title">
              {internalOpsCopy.home.monitoringHeading}
            </h2>
            <p>{internalOpsCopy.home.monitoringDescription}</p>
          </div>
        </div>
        <div className={styles.grid}>
          {monitoringSignals.map((signal) => (
            <SignalCard key={signal.label} signal={signal} />
          ))}
        </div>
      </section>
    </main>
  );
}
