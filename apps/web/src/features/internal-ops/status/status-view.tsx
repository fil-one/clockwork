import { getTranslations } from "@/src/i18n/server";
import { use } from "react";
import { localizeCopy } from "@/src/i18n/copy";
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
  const t = use(getTranslations());
  const localizedintegrationStatusCopy = localizeCopy(integrationStatusCopy, t);
  const readable = queues.deadLettersReadable && queues.webhooksReadable;
  return (
    <FinancePageFrame
      title={localizedintegrationStatusCopy.page.title}
      description={localizedintegrationStatusCopy.page.description}
      provenance={
        readable
          ? {
              kind: "read",
              source: localizedintegrationStatusCopy.source,
              readAt: now.toISOString(),
            }
          : {
              kind: "unreadable",
              source: localizedintegrationStatusCopy.sourceUnavailable,
            }
      }
    >
      <section
        className={styles.summaryGrid}
        aria-label={localizedintegrationStatusCopy.queues.label}
      >
        <article className={styles.summaryCard}>
          <p>{localizedintegrationStatusCopy.queues.dispatch}</p>
          <strong>{queues.dispatch}</strong>
          <span>{localizedintegrationStatusCopy.queues.denominator}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{localizedintegrationStatusCopy.queues.provisioning}</p>
          <strong>{queues.provisioning}</strong>
          <span>{localizedintegrationStatusCopy.queues.denominator}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{localizedintegrationStatusCopy.queues.workflow}</p>
          <strong>{queues.workflow}</strong>
          <span>{localizedintegrationStatusCopy.queues.denominator}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{localizedintegrationStatusCopy.queues.webhook}</p>
          <strong>{queues.webhook}</strong>
          <span>{localizedintegrationStatusCopy.queues.denominator}</span>
        </article>
      </section>
      {readable ? null : (
        <div className={styles.warningNotice} role="alert">
          <strong>Operational queue read incomplete.</strong>
          <span>{localizedintegrationStatusCopy.queues.unreadable}</span>
        </div>
      )}
      <section className={styles.notice} aria-label="Queue actions">
        <strong>Open the underlying records</strong>
        <span>
          <Link href="/internal/recovery">
            {localizedintegrationStatusCopy.queues.recoveryLink}
          </Link>
          {" · "}
          <Link href="/internal/webhook-replay">
            {localizedintegrationStatusCopy.queues.webhookLink}
          </Link>
        </span>
      </section>
      <StatusPanel />
    </FinancePageFrame>
  );
}
