import { localizeCopy } from "@/src/i18n/copy";
import { getTranslations } from "@/src/i18n/server";
import { use } from "react";
import Link from "next/link";
import type { Route } from "next";

import { ApplicationStatePanel, StatusBadge } from "@clockwork/ui";

import { plural } from "@/src/i18n/en";

import { customerPartnerCopy } from "../copy";
import { formatSurfaceTimestamp, type SurfaceFormatting } from "../formatting";
import styles from "./customer-pages.module.css";

const copy = customerPartnerCopy.customer;

/**
 * Counted from the list it introduces.
 *
 * The sentence above the obligations list was the fixed string "Four items need
 * a decision or follow-up." A reader with two obligations was told there were
 * four, and had nowhere to look for the missing two.
 */
function attentionDescription(
  count: number,
  locale: string,
  localized: typeof copy,
): string {
  if (count === 0) return localized.attentionDescriptionNone;
  return plural(
    count,
    localized.attentionDescriptionOne,
    localized.attentionDescriptionOther,
    locale,
  );
}

/**
 * The badge reports the term's own renewal position. An open notice window is
 * the decision that matters, so it outranks the renewal type.
 */
function renewalTone(
  term: CustomerDashboardProjection["term"],
): "neutral" | "success" | "warning" {
  if (/^opened\b/iu.test(term.noticeLabel)) return "warning";
  const state = term.renewalState.toLocaleLowerCase();
  if (state.includes("auto")) return "success";
  if (state.includes("expire")) return "warning";
  return "neutral";
}

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
  /** Null while the account has no metered usage to report. */
  capacity: {
    committed: string;
    current: string;
    prior: string;
    freshnessLabel: string;
  } | null;
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
  greetingName,
  formatting,
  canCreateQuote = true,
}: {
  projection: CustomerDashboardProjection;
  /** First name of the signed-in person, from the active route session. */
  greetingName: string;
  /**
   * Locale and zone of the person reading, from the active route session.
   * Required rather than defaulted: a default is how the hard-coded
   * `America/New_York` survived, and a surface that cannot say whose clock it
   * is showing should not be rendering a clock.
   */
  formatting: SurfaceFormatting;
  canCreateQuote?: boolean;
}) {
  const t = use(getTranslations());
  const localizedcopy = localizeCopy(copy, t);
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.taskHeader}>
        <div>
          <h1>
            {localizedcopy.dashboardGreeting}, {greetingName}
          </h1>
          <p>{localizedcopy.dashboardDescription}</p>
        </div>
        {canCreateQuote ? (
          <Link className={styles.primaryLink} href="/quotes/new">
            Create quote
          </Link>
        ) : (
          <p className={styles.permissionNote}>
            {localizedcopy.quotePermissionNote}
          </p>
        )}
      </header>

      <section className={styles.obligations} aria-labelledby="attention-title">
        <div className={styles.obligationHeading}>
          <div>
            <h2 id="attention-title">{localizedcopy.attentionTitle}</h2>
            <p>
              {attentionDescription(
                projection.obligations.length,
                formatting.locale,
                localizedcopy,
              )}
            </p>
          </div>
          <p className={styles.asOf}>
            {projection.stale
              ? "Stale account facts from "
              : "Account facts as of "}
            <time dateTime={projection.generatedAt}>
              {formatSurfaceTimestamp(projection.generatedAt, formatting)}
            </time>
          </p>
        </div>
        {projection.obligations.length === 0 ? (
          <ApplicationStatePanel
            state="empty"
            compact
            title="No open obligations"
            description={t("dashboard.empty.obligations")}
          />
        ) : null}
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
            <StatusBadge tone={renewalTone(projection.term)}>
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
            <span>{localizedcopy.serviceRollup}</span>
            <span className={styles.rollupCount}>
              {plural(
                projection.services.length,
                "{count} service",
                "{count} services",
              )}
            </span>
          </summary>
          {projection.services.length === 0 ? (
            <ApplicationStatePanel
              state="empty"
              compact
              title="No active service"
              description={t("dashboard.empty.services")}
            />
          ) : (
            <ul className={styles.serviceList}>
              {projection.services.map((service) => (
                <li key={service.id}>
                  <strong>{service.name}</strong>
                  <span>{service.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </details>
      </div>

      <details className={styles.supportingContext}>
        <summary>Usage and recent account activity</summary>
        <div className={styles.contextColumns}>
          <section aria-labelledby="capacity-facts-title">
            <h2 id="capacity-facts-title">Capacity facts</h2>
            {projection.capacity === null ? (
              <ApplicationStatePanel
                state="empty"
                compact
                title="Usage reporting is not connected yet"
                description={t("dashboard.empty.capacity")}
              />
            ) : (
              <>
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
              </>
            )}
          </section>
          <section aria-labelledby="activity-title">
            <h2 id="activity-title">{localizedcopy.activityTitle}</h2>
            {projection.activity.length === 0 ? (
              <ApplicationStatePanel
                state="empty"
                compact
                title="No recorded activity"
                description={t("dashboard.empty.activity")}
              />
            ) : (
              <ol className={styles.activityList}>
                {projection.activity.map((item) => (
                  <li key={item.id}>
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                    <time dateTime={item.occurredAt}>{item.occurredLabel}</time>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </details>
    </main>
  );
}
