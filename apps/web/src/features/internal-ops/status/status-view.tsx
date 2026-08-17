import Link from "next/link";

import styles from "../finance-lifecycle/finance-lifecycle.module.css";
import { FinancePageFrame } from "../finance-lifecycle/page-frame";
import { integrationStatusCopy } from "./copy";
import type { OperationalQueueStatus } from "./status-loader";
import { StatusPanel } from "./status-panel";

export function IntegrationStatusView({
  queues,
  now = new Date(),
}: {
  queues: OperationalQueueStatus;
  now?: Date;
}) {
  const readable = queues.deadLettersReadable && queues.webhooksReadable;
  return (
    <FinancePageFrame
      title={integrationStatusCopy.page.title}
      description={integrationStatusCopy.page.description}
      provenance={
        readable
          ? {
              kind: "read",
              source: integrationStatusCopy.source,
              readAt: now.toISOString(),
            }
          : {
              kind: "unreadable",
              source: integrationStatusCopy.sourceUnavailable,
            }
      }
    >
      <section
        className={styles.summaryGrid}
        aria-label={integrationStatusCopy.queues.label}
      >
        <article className={styles.summaryCard}>
          <p>{integrationStatusCopy.queues.dispatch}</p>
          <strong>{queues.dispatch}</strong>
          <span>{integrationStatusCopy.queues.denominator}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{integrationStatusCopy.queues.provisioning}</p>
          <strong>{queues.provisioning}</strong>
          <span>{integrationStatusCopy.queues.denominator}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{integrationStatusCopy.queues.workflow}</p>
          <strong>{queues.workflow}</strong>
          <span>{integrationStatusCopy.queues.denominator}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{integrationStatusCopy.queues.webhook}</p>
          <strong>{queues.webhook}</strong>
          <span>{integrationStatusCopy.queues.denominator}</span>
        </article>
      </section>
      {readable ? null : (
        <div className={styles.warningNotice} role="alert">
          <strong>Operational queue read incomplete.</strong>
          <span>{integrationStatusCopy.queues.unreadable}</span>
        </div>
      )}
      <section className={styles.notice} aria-label="Queue actions">
        <strong>Open the underlying records</strong>
        <span>
          <Link href="/internal/recovery">
            {integrationStatusCopy.queues.recoveryLink}
          </Link>
          {" · "}
          <Link href="/internal/webhook-replay">
            {integrationStatusCopy.queues.webhookLink}
          </Link>
        </span>
      </section>
      <StatusPanel />
    </FinancePageFrame>
  );
}
