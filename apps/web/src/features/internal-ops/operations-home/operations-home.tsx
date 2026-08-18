import Link from "next/link";

import { internalOpsCopy } from "../copy";
import { formatOperationalTimestamp } from "../presentation";
import type { OperationsHomeData, OperationalSignal } from "./server-loader";
import styles from "./operations-home.module.css";

function SignalRows({ signals }: { signals: readonly OperationalSignal[] }) {
  const areaLabels: Readonly<Record<string, string>> = {
    queues: "Approvals",
    provisioning: "Provisioning",
    collections: "Collections",
    orders: "Renewals",
    reports: "Reports",
  };
  return signals.map((signal) => (
    <tr key={signal.label} data-tone={signal.tone}>
      <th scope="row">
        <span className={styles.signalLabel}>{signal.label}</span>
        <strong className={styles.signalValue}>{signal.value}</strong>
      </th>
      <td>{signal.detail}</td>
      <td>{areaLabels[signal.channel] ?? signal.channel}</td>
      <td>
        <time dateTime={signal.generatedAt}>
          {formatOperationalTimestamp(signal.generatedAt)}
        </time>
        {signal.stale ? ` · ${internalOpsCopy.home.staleSuffix}` : ""}
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

/**
 * Where "Open my queue" goes.
 *
 * The label names the operator's own work, so the link states the saved view
 * that holds it. `/internal/queues` on its own opens `DEFAULT_FILTERS.view`,
 * which is `all` -- every operator's work, not this one's -- and a label that
 * says "my queue" over that destination is the same defect as a freshness
 * string with no read behind it. `QueueWorkspace` parses all four parameters
 * out of `useSearchParams`, so the destination arrives on the assigned view
 * rather than resetting to the default.
 *
 * `sort` is `sla-risk-age`, not the `priority` the earlier link carried:
 * `sortQueueItems` has no `priority` branch and no filter control offers one,
 * so that value fell through to this same ordering while leaving the sort
 * control matching no option and reading "All". The link now names the
 * ordering the page actually applies.
 */
const MY_QUEUE_HREF =
  "/internal/queues?view=assigned-to-me&sort=sla-risk-age&page=1&pageSize=25" as const;

export function OperationsHome({ data }: { data: OperationsHomeData }) {
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.taskHeader}>
        <div>
          <h1>{internalOpsCopy.home.title}</h1>
          <p>{internalOpsCopy.home.description}</p>
        </div>
        <p className={styles.freshness} role="status">
          Updated{" "}
          <time dateTime={data.generatedAt}>
            {formatOperationalTimestamp(data.generatedAt)}
          </time>
        </p>
      </header>

      {data.staleChannels.length > 0 ? (
        <p className={styles.freshness} role="alert">
          {internalOpsCopy.home.stale(data.staleChannels.join(", "))}
        </p>
      ) : null}

      <section aria-labelledby="action-health-title">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="action-health-title">
              {internalOpsCopy.home.healthHeading}
            </h2>
            <p>{internalOpsCopy.home.healthDescription}</p>
          </div>
          <Link className={styles.primaryLink} href={MY_QUEUE_HREF}>
            {internalOpsCopy.home.openQueue}
          </Link>
        </div>
        <div
          className={styles.tableRegion}
          role="region"
          aria-label={internalOpsCopy.home.tableLabel}
          tabIndex={0}
        >
          <table className={styles.signalTable}>
            <thead>
              <tr>
                <th scope="col">Signal</th>
                <th scope="col">Summary</th>
                <th scope="col">Area</th>
                <th scope="col">Updated</th>
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <SignalRows signals={data.signals} />
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
