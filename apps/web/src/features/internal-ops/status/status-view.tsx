import { getTranslations } from "@/src/i18n/server";
import { use } from "react";
import Link from "next/link";

import styles from "../finance-lifecycle/finance-lifecycle.module.css";
import { FinancePageFrame } from "../finance-lifecycle/page-frame";
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
  const readable = queues.deadLettersReadable && queues.webhooksReadable;
  const waiting = t("operations.status.queues.waiting");
  return (
    <FinancePageFrame
      title={t("operations.status.title")}
      description={t("operations.status.description")}
      provenance={
        readable
          ? {
              kind: "read",
              source: t("operations.status.source"),
              readAt: now.toISOString(),
            }
          : {
              kind: "unreadable",
              source: t("operations.status.source.unavailable"),
            }
      }
    >
      <section
        className={styles.summaryGrid}
        aria-label={t("operations.status.queues.label")}
      >
        <article className={styles.summaryCard}>
          <p>{t("operations.status.queues.dispatch")}</p>
          <strong>{queues.dispatch}</strong>
          <span>{waiting}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{t("operations.status.queues.provisioning")}</p>
          <strong>{queues.provisioning}</strong>
          <span>{waiting}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{t("operations.status.queues.workflow")}</p>
          <strong>{queues.workflow}</strong>
          <span>{waiting}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{t("operations.status.queues.webhook")}</p>
          <strong>{queues.webhook}</strong>
          <span>{waiting}</span>
        </article>
      </section>
      {readable ? null : (
        <div className={styles.warningNotice} role="alert">
          <strong>{t("operations.status.queues.incomplete")}</strong>
          <span>{t("operations.status.queues.unreadable")}</span>
        </div>
      )}
      <section
        className={styles.notice}
        aria-label={t("operations.status.links.label")}
      >
        <strong>{t("operations.status.links.title")}</strong>
        <span>
          <Link href="/internal/recovery">
            {t("operations.status.links.recovery")}
          </Link>
          {" · "}
          <Link href="/internal/webhook-replay">
            {t("operations.status.links.webhookReplay")}
          </Link>
        </span>
      </section>
      <StatusPanel />
    </FinancePageFrame>
  );
}
