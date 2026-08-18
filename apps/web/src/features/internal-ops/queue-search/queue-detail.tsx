import type { Route } from "next";
import Link from "next/link";

import styles from "./queue-search.module.css";
import { QUEUE_COPY } from "./copy";
import {
  permittedActions,
  slaFor,
  type OperationalRole,
  type QueueItem,
} from "./model";

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

const NOT_RECORDED = "Not recorded";

function Moment({ value }: { value: string | null }) {
  if (!value) return <>{NOT_RECORDED}</>;
  return <time dateTime={value}>{DATE_TIME.format(new Date(value))}</time>;
}

export function QueueDetail({
  item,
  roles = ["internal_operator"],
  standalone = false,
  now,
}: {
  item: QueueItem;
  roles?: readonly OperationalRole[];
  standalone?: boolean;
  now?: Date;
}) {
  const actions = permittedActions(item, roles);
  const restricted = actions.length !== item.permittedActions.length;
  const sla = slaFor(item, now);
  return (
    <article
      className={standalone ? styles.detailStandalone : styles.detail}
      aria-labelledby={`detail-title-${item.id}`}
    >
      <header className={styles.detailHeader}>
        <div>
          <p className={styles.eyebrow}>
            {item.type ? `${item.type} queue · ` : ""}
            {item.id}
          </p>
          <h2 id={`detail-title-${item.id}`}>{item.title}</h2>
          {item.entity ? <p className={styles.entity}>{item.entity}</p> : null}
        </div>
        {sla ? (
          <span className={`${styles.sla} ${styles[`sla_${sla}`]}`}>
            {sla === "breached"
              ? "SLA breached"
              : sla === "due-soon"
                ? "Due soon"
                : "SLA healthy"}
          </span>
        ) : null}
      </header>

      {item.summary ? (
        <p className={styles.detailSummary}>{item.summary}</p>
      ) : null}

      {/*
        Whether an item is owned and what state it is in drives the operator's
        next move, so those rows appear even when the value is absent. A backup,
        a risk band, and a deadline are not carried by every queue type; those
        rows appear only once there is something to read.
      */}
      <dl className={styles.detailFacts}>
        <div>
          <dt>{QUEUE_COPY.details.owner}</dt>
          <dd>{item.owner ?? NOT_RECORDED}</dd>
        </div>
        {item.backup ? (
          <div>
            <dt>{QUEUE_COPY.details.backup}</dt>
            <dd>{item.backup}</dd>
          </div>
        ) : null}
        {item.risk ? (
          <div>
            <dt>{QUEUE_COPY.details.risk}</dt>
            <dd>
              <span className={`${styles.risk} ${styles[`risk_${item.risk}`]}`}>
                {item.risk}
              </span>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{QUEUE_COPY.details.status}</dt>
          <dd>{item.statusLabel ?? item.status ?? NOT_RECORDED}</dd>
        </div>
        {item.createdAt ? (
          <div>
            <dt>{QUEUE_COPY.details.created}</dt>
            <dd>
              <Moment value={item.createdAt} />
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{QUEUE_COPY.details.updated}</dt>
          <dd>
            <Moment value={item.updatedAt} />
          </dd>
        </div>
        {item.dueAt ? (
          <div>
            <dt>{QUEUE_COPY.details.deadline}</dt>
            <dd>
              <Moment value={item.dueAt} />
            </dd>
          </div>
        ) : null}
      </dl>

      {item.policyReason || item.policyBasis ? (
        <section
          className={styles.detailSection}
          aria-labelledby={`policy-${item.id}`}
        >
          <h3 id={`policy-${item.id}`}>{QUEUE_COPY.details.reason}</h3>
          {item.policyReason ? <p>{item.policyReason}</p> : null}
          {item.policyBasis ? (
            <p className={styles.policyBasis}>
              <strong>{QUEUE_COPY.details.policy}</strong> {item.policyBasis}
            </p>
          ) : null}
        </section>
      ) : null}

      <section
        className={styles.detailSection}
        aria-labelledby={`evidence-${item.id}`}
      >
        <h3 id={`evidence-${item.id}`}>{QUEUE_COPY.details.evidence}</h3>
        <dl className={styles.evidenceList}>
          {item.evidence.map((entry) => (
            <div key={entry.label}>
              <dt>{entry.label}</dt>
              <dd>
                {entry.value}
                {entry.technicalId ? (
                  <details className={styles.technicalDisclosure}>
                    <summary>{QUEUE_COPY.details.technicalId}</summary>
                    <code>{entry.technicalId}</code>
                  </details>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {item.related.length ? (
        <section
          className={styles.detailSection}
          aria-labelledby={`related-${item.id}`}
        >
          <h3 id={`related-${item.id}`}>{QUEUE_COPY.details.related}</h3>
          <ul className={styles.linkList}>
            {item.related.map((record) => (
              <li key={record.label}>
                <Link href={record.href as Route}>{record.label}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section
        className={styles.detailSection}
        aria-labelledby={`actions-${item.id}`}
      >
        <h3 id={`actions-${item.id}`}>{QUEUE_COPY.details.actions}</h3>
        {restricted ? (
          <p className={styles.permissionNote} role="note">
            Some decision actions are hidden because this session does not have
            the required {item.requiredRole?.replaceAll("_", " ")} role.
          </p>
        ) : null}
        <div className={styles.actionHandoff} role="note">
          <strong>Review only</strong>
          <p>
            Nothing is submitted here. Continue through the authorized workflow,
            where role, actor, policy, and provider gates are revalidated.
          </p>
          {actions.length ? (
            <ul>
              {actions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          ) : (
            <p>No actions are available for this role and record state.</p>
          )}
        </div>
      </section>
    </article>
  );
}

export function QueueDetailNotFound({ id }: { id: string }) {
  return (
    <main className={styles.page} id="main-content">
      <section className={styles.stateCard} role="status">
        <p className={styles.eyebrow}>{QUEUE_COPY.details.unavailable}</p>
        <h1>We couldn’t find “{id}”</h1>
        <p>
          It may have been resolved, moved, or removed from your permission
          scope.
        </p>
        <Link className={styles.secondaryButton} href="/internal/queues">
          {QUEUE_COPY.details.back}
        </Link>
      </section>
    </main>
  );
}
