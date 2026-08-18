import { StatusBadge, Table } from "@clockwork/ui";

import { SurfaceActionGate } from "@/src/features/shell/permission-gate";

import styles from "../finance-lifecycle/finance-lifecycle.module.css";
import { FinancePageFrame } from "../finance-lifecycle/page-frame";
import { formatOperationalTimestamp } from "../presentation";
import { unhandledErrorsCopy } from "./copy";
import { IncidentDecisionControl } from "./incident-decision";
import {
  diagnosableCount,
  groupIncidents,
  runtimeFailureEventTypes,
  type IncidentQueue,
  type IncidentSignature,
} from "./model";

const { page, summary, unreadable, unwiredDetail, table } = unhandledErrorsCopy;

const catalogueSize = runtimeFailureEventTypes.length;

function Cause({ signature }: { signature: IncidentSignature }) {
  const { diagnosis: found } = signature.latest;
  if (found.kind === "provider_message")
    return (
      <div className={styles.primaryCell}>
        <strong>{found.message}</strong>
        <span className={styles.secondary}>{found.provenance}</span>
      </div>
    );
  return (
    <div className={styles.primaryCell}>
      <strong>{table.codeOnlyCell}</strong>
      <span className={styles.secondary}>{found.discardedAt}</span>
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
function Where({ signature }: { signature: IncidentSignature }) {
  const { boundary, taskIdentifier } = signature.latest;
  return (
    <div className={styles.primaryCell}>
      <strong>{boundary ?? table.boundaryMissing}</strong>
      <span className={styles.secondary}>
        {taskIdentifier ? `task ${taskIdentifier}` : table.taskMissing}
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
function Record({ signature }: { signature: IncidentSignature }) {
  const { aggregateId, requestId, auditEventId, outboxMessageId } =
    signature.latest;
  return (
    <div className={styles.primaryCell}>
      <strong>
        {signature.aggregateType} {aggregateId}
      </strong>
      <span className={styles.secondary}>
        {table.requestPrefix} {requestId}
      </span>
      <span className={styles.secondary}>
        {table.auditPrefix} {auditEventId}
      </span>
      <span className={styles.secondary}>
        {outboxMessageId
          ? `${table.outboxPrefix} ${outboxMessageId}`
          : table.outboxMissing}
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
  const signatures = groupIncidents(incidents);
  const withCause = diagnosableCount(signatures);
  const failureNotice = readable ? null : unreadable[state];

  return (
    <FinancePageFrame
      title={page.title}
      description={page.description}
      provenance={
        readable
          ? { kind: "read", source, readAt: now.toISOString() }
          : state === "no_connection"
            ? { kind: "unwired", detail: unwiredDetail }
            : { kind: "unreadable", source }
      }
    >
      <section className={styles.summaryGrid} aria-label={summary.label}>
        <article className={styles.summaryCard}>
          <p>{summary.signatures.title}</p>
          <strong>{signatures.length}</strong>
          <span>{summary.signatures.detail}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{summary.occurrences.title}</p>
          <strong>{incidents.length}</strong>
          <span>{summary.occurrences.detail}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{summary.diagnosable.title}</p>
          <strong>{withCause}</strong>
          <span>{summary.diagnosable.detail}</span>
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
            <h2 id="failure-signatures">{table.heading}</h2>
            <p>{table.subheading}</p>
          </div>
          <span className={styles.sectionMeta}>
            {table.count(signatures.length)}
          </span>
        </header>
        {signatures.length === 0 && readable ? (
          <p className={styles.empty}>{table.empty(catalogueSize)}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={table.caption}
            captionHidden
            density="compact"
            headers={[
              table.columns.failure,
              table.columns.boundary,
              table.columns.record,
              table.columns.cause,
              table.columns.occurrences,
              table.columns.window,
              table.columns.decision,
            ]}
            numericColumns={[4]}
            rowKeys={signatures.map((signature) => signature.key)}
            rows={signatures.map((signature) => [
              <div className={styles.primaryCell}>
                <strong>{signature.safeCode ?? table.codeMissing}</strong>
                <span className={styles.secondary}>{signature.eventType}</span>
              </div>,
              <Where signature={signature} />,
              <Record signature={signature} />,
              <Cause signature={signature} />,
              <strong>{table.occurrencesCell(signature.occurrences)}</strong>,
              <div className={styles.primaryCell}>
                <strong>
                  <time dateTime={signature.lastSeenAt}>
                    {formatOperationalTimestamp(signature.lastSeenAt)}
                  </time>
                </strong>
                <span className={styles.secondary}>
                  first{" "}
                  <time dateTime={signature.firstSeenAt}>
                    {formatOperationalTimestamp(signature.firstSeenAt)}
                  </time>
                </span>
              </div>,
              <div className={styles.actionStack}>
                {signature.latest.latestDecision ? (
                  <StatusBadge
                    tone={
                      signature.latest.latestDecision === "contain"
                        ? "warning"
                        : "neutral"
                    }
                  >
                    {table.decidedCell(
                      signature.latest.latestDecision,
                      signature.latest.latestDecisionReason,
                    )}
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
            ])}
          />
        )}
      </section>
    </FinancePageFrame>
  );
}
