import { StatusBadge, Table } from "@clockwork/ui";

import { SurfaceActionGate } from "@/src/features/shell/permission-gate";

import styles from "../finance-lifecycle/finance-lifecycle.module.css";
import { FinancePageFrame } from "../finance-lifecycle/page-frame";
import { use } from "react";

import type { Translator } from "@/src/i18n";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { richText } from "@/src/i18n/rich";

import { formatOperationalTimestamp } from "../presentation";
import {
  causeDiscardText,
  incidentDecisionLabels,
  incidentSourceLabels,
  provenanceLabels,
} from "./copy";
import { IncidentDecisionControl } from "./incident-decision";
import {
  diagnosableCount,
  groupIncidents,
  type IncidentQueue,
  type IncidentSignature,
} from "./model";

function Cause({
  signature,
  t,
}: {
  signature: IncidentSignature;
  t: Translator;
}) {
  const { diagnosis: found } = signature.latest;
  if (found.kind === "provider_message")
    return (
      <div className={styles.primaryCell}>
        <strong>{found.message}</strong>
        <span className={styles.secondary}>
          {t(provenanceLabels[found.provenance])}
        </span>
      </div>
    );
  return (
    <div className={styles.primaryCell}>
      <strong>{t("operations.incidents.cause.codeOnly")}</strong>
      <span className={styles.secondary}>
        {causeDiscardText(found.discardedAt, t)}
      </span>
    </div>
  );
}

/**
 * Boundary and task identifier, kept apart.
 *
 * These used to be one cell that fell back `boundary ?? taskIdentifier ??
 * eventType`, so a row with no boundary displayed its task id -- or its event
 * type -- under a heading reading "Boundary". Every value shown was real and
 * the heading was still wrong about it. Step 1 of the runbook asks for the
 * boundary and the task identifier as separate facts, and several catalogued
 * writers record neither, so each absence is stated.
 */
function Where({
  signature,
  t,
}: {
  signature: IncidentSignature;
  t: Translator;
}) {
  const { boundary, taskIdentifier } = signature.latest;
  return (
    <div className={styles.primaryCell}>
      <strong>{boundary ?? t("operations.incidents.row.noBoundary")}</strong>
      <span className={styles.secondary}>
        {taskIdentifier
          ? t("operations.incidents.row.task", { id: taskIdentifier })
          : t("operations.incidents.row.noTask")}
      </span>
    </div>
  );
}

/**
 * The identifiers step 1 asks the operator to write down, all of them present.
 * The audit event id and the outbox message id were read from the database and
 * then dropped before render, while the runbook told the operator this surface
 * carried them.
 */
function Record({
  signature,
  t,
}: {
  signature: IncidentSignature;
  t: Translator;
}) {
  const { aggregateId, requestId, auditEventId, outboxMessageId } =
    signature.latest;
  return (
    <div className={styles.primaryCell}>
      <strong>
        {signature.aggregateType} {aggregateId}
      </strong>
      <span className={styles.secondary}>
        {t("operations.incidents.row.request", { id: requestId })}
      </span>
      <span className={styles.secondary}>
        {t("operations.incidents.row.auditEvent", { id: auditEventId })}
      </span>
      <span className={styles.secondary}>
        {outboxMessageId
          ? t("operations.incidents.row.outbox", { id: outboxMessageId })
          : t("operations.incidents.row.noOutbox")}
      </span>
    </div>
  );
}

export function UnhandledErrorsView({
  result,
  now = new Date(),
}: {
  result: IncidentQueue;
  now?: Date;
}) {
  const { incidents, readable, source, state } = result;
  const t = use(getTranslations());
  const formattingLocale = use(getFormattingLocale());
  const signatures = groupIncidents(incidents);
  const withCause = diagnosableCount(signatures);
  const sourceLabel = t(incidentSourceLabels[source]);
  const failureNotice = readable
    ? null
    : state === "no_connection"
      ? {
          title: t("operations.incidents.unwired.title"),
          detail: t("operations.incidents.unwired.detail"),
        }
      : {
          title: t("operations.incidents.unreadable.title"),
          detail: t("operations.incidents.unreadable.detail"),
        };

  return (
    <FinancePageFrame
      title={t("operations.incidents.title")}
      description={t("operations.incidents.description")}
      provenance={
        readable
          ? { kind: "read", source: sourceLabel, readAt: now.toISOString() }
          : state === "no_connection"
            ? {
                kind: "unwired",
                detail: t("operations.incidents.unwired.provenance"),
              }
            : { kind: "unreadable", source: sourceLabel }
      }
    >
      <section
        className={styles.summaryGrid}
        aria-label={t("operations.incidents.signatures.heading")}
      >
        <article className={styles.summaryCard}>
          <p>{t("operations.incidents.summary.signatures")}</p>
          <strong>{signatures.length}</strong>
          <span>{t("operations.incidents.summary.signatures.detail")}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{t("operations.incidents.summary.occurrences")}</p>
          <strong>{incidents.length}</strong>
          <span>{t("operations.incidents.summary.occurrences.detail")}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{t("operations.incidents.summary.withCause")}</p>
          <strong>{withCause}</strong>
          <span>{t("operations.incidents.summary.withCause.detail")}</span>
        </article>
      </section>

      {failureNotice ? (
        <div className={styles.warningNotice} role="alert">
          <strong>{failureNotice.title}</strong>
          <span>{failureNotice.detail}</span>
        </div>
      ) : null}

      <section className={styles.section} aria-labelledby="failure-signatures">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="failure-signatures">
              {t("operations.incidents.signatures.heading")}
            </h2>
            <p>{t("operations.incidents.signatures.subheading")}</p>
          </div>
          <span className={styles.sectionMeta}>
            {t("operations.incidents.signatures.count", {
              count: signatures.length,
            })}
          </span>
        </header>
        {signatures.length === 0 && readable ? (
          <p className={styles.empty}>
            {t("operations.incidents.signatures.empty")}
          </p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={t("operations.incidents.signatures.caption")}
            captionHidden
            density="compact"
            headers={[
              t("operations.incidents.column.failure"),
              t("operations.incidents.column.boundary"),
              t("operations.incidents.column.record"),
              t("operations.incidents.column.cause"),
              t("operations.incidents.summary.occurrences"),
              t("operations.incidents.column.window"),
              t("operations.column.decision"),
            ]}
            numericColumns={[4]}
            rowKeys={signatures.map((signature) => signature.key)}
            rows={signatures.map((signature) => {
              const decided = signature.latest.latestDecision;
              const decidedReason = signature.latest.latestDecisionReason;
              return [
                <div className={styles.primaryCell}>
                  <strong>
                    {signature.safeCode ?? t("operations.incidents.row.noCode")}
                  </strong>
                  <span className={styles.secondary}>
                    {signature.eventType}
                  </span>
                </div>,
                <Where signature={signature} t={t} />,
                <Record signature={signature} t={t} />,
                <Cause signature={signature} t={t} />,
                <strong>
                  {new Intl.NumberFormat(formattingLocale).format(
                    signature.occurrences,
                  )}
                </strong>,
                <div className={styles.primaryCell}>
                  <strong>
                    <time dateTime={signature.lastSeenAt}>
                      {formatOperationalTimestamp(
                        signature.lastSeenAt,
                        formattingLocale,
                      )}
                    </time>
                  </strong>
                  <span className={styles.secondary}>
                    {richText(t, "operations.incidents.row.firstSeen", {
                      time: (
                        <time dateTime={signature.firstSeenAt}>
                          {formatOperationalTimestamp(
                            signature.firstSeenAt,
                            formattingLocale,
                          )}
                        </time>
                      ),
                    })}
                  </span>
                </div>,
                <div className={styles.actionStack}>
                  {decided ? (
                    <StatusBadge
                      tone={decided === "contain" ? "warning" : "neutral"}
                    >
                      {decidedReason
                        ? t(
                            incidentDecisionLabels[decided].recordedWithReason,
                            {
                              reason: decidedReason,
                            },
                          )
                        : t(incidentDecisionLabels[decided].recorded)}
                    </StatusBadge>
                  ) : null}
                  <SurfaceActionGate
                    audience="internal"
                    requiredPermission="system:operate"
                  >
                    <IncidentDecisionControl
                      decision="contain"
                      auditEventId={signature.latest.auditEventId}
                      label={signature.safeCode ?? signature.eventType}
                    />
                    <IncidentDecisionControl
                      decision="release"
                      auditEventId={signature.latest.auditEventId}
                      label={signature.safeCode ?? signature.eventType}
                    />
                  </SurfaceActionGate>
                </div>,
              ];
            })}
          />
        )}
      </section>
    </FinancePageFrame>
  );
}
