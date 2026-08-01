import Link from "next/link";

import {
  actionSignals,
  internalOpsCopy,
  monitoringSignals,
  type OperationalSignal,
} from "../copy";
import styles from "./operations-home.module.css";

function SignalRows({ signals }: { signals: readonly OperationalSignal[] }) {
  return signals.map((signal) => (
    <tr key={signal.label} data-tone={signal.tone}>
      <th scope="row">
        <span className={styles.signalLabel}>{signal.label}</span>
        <strong className={styles.signalValue}>{signal.value}</strong>
      </th>
      <td>{signal.detail}</td>
      <td>{signal.truth ?? "Unclassified"}</td>
      <td>{signal.owner}</td>
      <td>
        <time dateTime={signal.observedAt}>{signal.freshness}</time>
      </td>
      <td>
        <Link href={signal.href}>
          {signal.action}
          <span aria-hidden="true"> →</span>
        </Link>
      </td>
    </tr>
  ));
}

function SignalTable({
  label,
  signals,
}: {
  label: string;
  signals: readonly OperationalSignal[];
}) {
  return (
    <div
      className={styles.tableRegion}
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table className={styles.signalTable}>
        <thead>
          <tr>
            <th scope="col">Signal</th>
            <th scope="col">Consequence</th>
            <th scope="col">Truth source</th>
            <th scope="col">Owner</th>
            <th scope="col">Freshness</th>
            <th scope="col">
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <SignalRows signals={signals} />
        </tbody>
      </table>
    </div>
  );
}

export function OperationsHome() {
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.taskHeader}>
        <div>
          <h1>{internalOpsCopy.home.title}</h1>
          <p>{internalOpsCopy.home.description}</p>
        </div>
        <p className={styles.freshness} role="status">
          {internalOpsCopy.home.refreshed}
        </p>
      </header>

      <section aria-labelledby="recommended-actions-title">
        <div className={styles.sectionHeading}>
          <div>
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
            <h2 id="action-health-title">
              {internalOpsCopy.home.healthHeading}
            </h2>
            <p>
              Severity, consequence, source, owner, and age remain comparable in
              one row.
            </p>
          </div>
        </div>
        <SignalTable
          label="Work requiring action table"
          signals={actionSignals}
        />
      </section>

      <section aria-labelledby="monitoring-title">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="monitoring-title">
              {internalOpsCopy.home.monitoringHeading}
            </h2>
            <p>{internalOpsCopy.home.monitoringDescription}</p>
          </div>
        </div>
        <SignalTable
          label="Monitoring signals table"
          signals={monitoringSignals}
        />
      </section>
    </main>
  );
}
