import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { use } from "react";
import { Table } from "@clockwork/ui";

import { SurfaceActionGate } from "@/src/features/shell/permission-gate";

import styles from "../finance-lifecycle/finance-lifecycle.module.css";
import { MachineCode } from "../machine-code";
import { formatOperationalTimestamp } from "../presentation";
import { callbackStateLabels, replaySourceLabels } from "./copy";
import { ReplayDecision } from "./replay-decision";
import type { WebhookReplayQueue } from "./webhook-replay-loader";

export function WebhookReplayView({ queue }: { queue: WebhookReplayQueue }) {
  const t = use(getTranslations());
  const formattingLocale = use(getFormattingLocale());
  return (
    <main className={styles.page} id="main-content">
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <h1 className={styles.title}>
            {t("operations.webhookReplay.title")}
          </h1>
          <p className={styles.description}>
            {t("operations.webhookReplay.description")}
          </p>
        </div>
        <p className={styles.freshness}>
          <strong>
            {queue.readable
              ? t("operations.webhookReplay.freshness.read")
              : t("operations.webhookReplay.freshness.unread")}
          </strong>
          {t(replaySourceLabels[queue.source])}
        </p>
      </header>

      {queue.readable ? null : (
        <div className={styles.warningNotice} role="alert">
          <strong>{t("operations.webhookReplay.unreadable.title")}</strong>
          <span>{t("operations.webhookReplay.unreadable.detail")}</span>
        </div>
      )}

      <section className={styles.section} aria-labelledby="stopped-callbacks">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="stopped-callbacks">
              {t("operations.webhookReplay.section.heading")}
            </h2>
            <p>{t("operations.webhookReplay.section.hint")}</p>
          </div>
          <span className={styles.sectionMeta}>
            {t("operations.webhookReplay.count", {
              count: queue.events.length,
            })}
          </span>
        </header>

        {queue.readable && queue.events.length === 0 ? (
          <p className={styles.empty}>{t("operations.webhookReplay.empty")}</p>
        ) : (
          <Table
            className={`${styles.dsTable ?? ""} ${styles.denseTable ?? ""}`}
            caption={t("operations.webhookReplay.caption")}
            captionHidden
            density="compact"
            headers={[
              t("operations.webhookReplay.column.provider"),
              t("operations.webhookReplay.column.callback"),
              t("operations.column.type"),
              t("operations.webhookReplay.column.state"),
              t("operations.webhookReplay.column.received"),
              t("operations.column.attempts"),
              t("operations.webhookReplay.column.lastError"),
              t("operations.column.decision"),
            ]}
            numericColumns={[5]}
            rowKeys={queue.events.map((event) => event.id)}
            rows={queue.events.map((event) => [
              event.provider,
              <div className={styles.primaryCell}>
                <strong>
                  <MachineCode
                    className={styles.code}
                    value={event.providerEventId}
                  />
                </strong>
              </div>,
              <MachineCode className={styles.code} value={event.eventType} />,
              t(callbackStateLabels[event.state]),
              // Minute precision in UTC, so two operators reading the same row
              // agree, worded in the reader's locale.
              <time dateTime={event.occurredAt}>
                {formatOperationalTimestamp(event.occurredAt, formattingLocale)}
              </time>,
              <strong>{event.attemptCount}</strong>,
              event.processingError ? (
                <MachineCode
                  className={styles.code}
                  value={event.processingError}
                />
              ) : (
                t("common.notRecorded")
              ),
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
              </div>,
            ])}
          />
        )}
      </section>
    </main>
  );
}
