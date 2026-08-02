import { SurfaceActionGate } from "@/src/features/shell/permission-gate";

import styles from "../finance-lifecycle/finance-lifecycle.module.css";
import { webhookReplayCopy } from "./copy";
import { ReplayDecision } from "./replay-decision";
import type { WebhookReplayQueue } from "./webhook-replay-loader";

/** Minute precision in UTC, so two operators reading the same row agree. */
function received(instant: string): string {
  return `${instant.slice(0, 16).replace("T", " ")} UTC`;
}

export function WebhookReplayView({ queue }: { queue: WebhookReplayQueue }) {
  return (
    <main className={styles.page} id="main-content">
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <h1 className={styles.title}>{webhookReplayCopy.title}</h1>
          <p className={styles.description}>{webhookReplayCopy.description}</p>
        </div>
        <p className={styles.freshness}>
          <strong>
            {queue.readable
              ? webhookReplayCopy.freshnessReadable
              : webhookReplayCopy.freshnessUnreadable}
          </strong>
          {queue.source}
        </p>
      </header>

      {queue.readable ? null : (
        <div className={styles.warningNotice} role="alert">
          <strong>{webhookReplayCopy.unreadableTitle}</strong>
          <span>{webhookReplayCopy.unreadableBody}</span>
        </div>
      )}

      <section className={styles.section} aria-labelledby="stopped-callbacks">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="stopped-callbacks">{webhookReplayCopy.sectionHeading}</h2>
            <p>{webhookReplayCopy.sectionHint}</p>
          </div>
          <span className={styles.sectionMeta}>
            {queue.events.length}{" "}
            {queue.events.length === 1 ? "callback" : "callbacks"}
          </span>
        </header>

        {queue.readable && queue.events.length === 0 ? (
          <p className={styles.empty}>{webhookReplayCopy.empty}</p>
        ) : (
          <div className={styles.tableScroll} tabIndex={0}>
            <table className={styles.table}>
              <caption className="sr-only">
                {webhookReplayCopy.tableCaption}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{webhookReplayCopy.columns.provider}</th>
                  <th scope="col">{webhookReplayCopy.columns.callback}</th>
                  <th scope="col">{webhookReplayCopy.columns.eventType}</th>
                  <th scope="col">{webhookReplayCopy.columns.state}</th>
                  <th scope="col">{webhookReplayCopy.columns.received}</th>
                  <th scope="col">{webhookReplayCopy.columns.attempts}</th>
                  <th scope="col">{webhookReplayCopy.columns.failure}</th>
                  <th scope="col">{webhookReplayCopy.columns.decision}</th>
                </tr>
              </thead>
              <tbody>
                {queue.events.map((event) => (
                  <tr key={event.id}>
                    <td>{event.provider}</td>
                    <td>
                      <div className={styles.primaryCell}>
                        <strong>{event.providerEventId}</strong>
                      </div>
                    </td>
                    <td>{event.eventType}</td>
                    <td>{webhookReplayCopy.stateLabel[event.state]}</td>
                    <td>
                      <time dateTime={event.occurredAt}>
                        {received(event.occurredAt)}
                      </time>
                    </td>
                    <td>
                      <strong>{event.attemptCount}</strong>
                    </td>
                    <td>
                      {event.processingError ?? webhookReplayCopy.noError}
                    </td>
                    <td>
                      <div className={styles.actionStack}>
                        <SurfaceActionGate
                          audience="internal"
                          requiredPermission="system:operate"
                        >
                          <ReplayDecision
                            provider={event.provider}
                            providerEventId={event.providerEventId}
                            eventType={event.eventType}
                            payloadHash={event.payloadHash}
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
    </main>
  );
}
