import Link from "next/link";
import type { Route } from "next";

import { StatusBadge } from "@clockwork/ui";

import { customerPartnerCopy } from "../copy";
import styles from "./customer-pages.module.css";

const copy = customerPartnerCopy.customer;

export interface CustomerDashboardProjection {
  generatedAt: string;
  stale: boolean;
  obligations: readonly {
    id: string;
    priority: number;
    type: string;
    title: string;
    detail: string;
    actionLabel: string;
    href: Route;
    tone: "neutral" | "success" | "warning" | "danger";
    state: string;
    recordVersion: number;
  }[];
  term: {
    title: string;
    rangeLabel: string;
    progressPercent: number;
    progressLabel: string;
    renewalState: string;
    noticeLabel: string;
    renewalLabel: string;
    agreementLabel: string;
  };
  services: readonly { id: string; name: string; detail: string }[];
  capacity: {
    committed: string;
    current: string;
    prior: string;
    freshnessLabel: string;
  };
  activity: readonly {
    id: string;
    title: string;
    detail: string;
    occurredAt: string;
    occurredLabel: string;
  }[];
}

export function CustomerDashboard({
  projection,
  canCreateQuote = true,
}: {
  projection: CustomerDashboardProjection;
  canCreateQuote?: boolean;
}) {
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.taskHeader}>
        <div>
          <h1>{copy.dashboardTitle}</h1>
          <p>{copy.dashboardDescription}</p>
        </div>
        {canCreateQuote ? (
          <Link className={styles.primaryLink} href="/quotes/new">
            Create quote
          </Link>
        ) : (
          <p className={styles.permissionNote}>{copy.quotePermissionNote}</p>
        )}
      </header>

      <section className={styles.obligations} aria-labelledby="attention-title">
        <div className={styles.obligationHeading}>
          <div>
            <h2 id="attention-title">{copy.attentionTitle}</h2>
            <p>{copy.attentionDescription}</p>
          </div>
          <p className={styles.asOf}>
            {projection.stale
              ? "Stale account facts from "
              : "Account facts as of "}
            <time dateTime={projection.generatedAt}>
              {new Intl.DateTimeFormat("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "America/New_York",
              }).format(new Date(projection.generatedAt))}
            </time>
          </p>
        </div>
        <ol className={styles.obligationList}>
          {projection.obligations.map((item) => (
            <li key={item.id}>
              <span className={styles.obligationPriority} aria-hidden="true">
                {item.priority}
              </span>
              <div className={styles.obligationCopy}>
                <div>
                  <span className={styles.attentionType}>{item.type}</span>
                  <StatusBadge tone={item.tone}>{item.state}</StatusBadge>
                </div>
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
              </div>
              <Link
                className={styles.obligationAction}
                href={item.href}
                data-record-version={item.recordVersion}
              >
                {item.actionLabel}
                <span aria-hidden="true"> →</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <div className={styles.commercialGrid}>
        <section className={styles.termCard} aria-labelledby="term-title">
          <div className={styles.termTop}>
            <div>
              <p className={styles.eyebrow}>Account agreement</p>
              <h2 id="term-title">{projection.term.title}</h2>
              <p className={styles.termRange}>{projection.term.rangeLabel}</p>
            </div>
            <StatusBadge tone="success">
              {projection.term.renewalState}
            </StatusBadge>
          </div>
          <div
            className={styles.termTrack}
            role="img"
            aria-label={projection.term.progressLabel}
          >
            <div
              className={styles.termProgress}
              style={{ width: `${projection.term.progressPercent}%` }}
            />
          </div>
          <dl className={styles.termMilestones}>
            <div>
              <dt>Notice window</dt>
              <dd>{projection.term.noticeLabel}</dd>
            </div>
            <div>
              <dt>Renewal</dt>
              <dd>{projection.term.renewalLabel}</dd>
            </div>
            <div>
              <dt>Governing agreement</dt>
              <dd>{projection.term.agreementLabel}</dd>
            </div>
          </dl>
        </section>

        <details className={styles.rollup}>
          <summary>
            <span>{copy.serviceRollup}</span>
            <span className={styles.rollupCount}>
              {projection.services.length} services
            </span>
          </summary>
          <ul className={styles.serviceList}>
            {projection.services.map((service) => (
              <li key={service.id}>
                <strong>{service.name}</strong>
                <span>{service.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>

      <details className={styles.supportingContext}>
        <summary>Usage and recent account activity</summary>
        <div className={styles.contextColumns}>
          <section aria-labelledby="capacity-facts-title">
            <h2 id="capacity-facts-title">Capacity facts</h2>
            <dl className={styles.capacityFacts}>
              <div>
                <dt>Committed</dt>
                <dd>{projection.capacity.committed}</dd>
              </div>
              <div>
                <dt>Current use</dt>
                <dd>{projection.capacity.current}</dd>
              </div>
              <div>
                <dt>Prior 30 days</dt>
                <dd>{projection.capacity.prior}</dd>
              </div>
            </dl>
            <p className={styles.freshness}>
              {projection.capacity.freshnessLabel}
            </p>
          </section>
          <section aria-labelledby="activity-title">
            <h2 id="activity-title">{copy.activityTitle}</h2>
            <ol className={styles.activityList}>
              {projection.activity.map((item) => (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                  <time dateTime={item.occurredAt}>{item.occurredLabel}</time>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </details>
    </main>
  );
}
