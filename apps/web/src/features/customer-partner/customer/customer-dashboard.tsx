import { getTranslations } from "@/src/i18n/server";
import { use } from "react";
import Link from "next/link";
import type { Route } from "next";

import { ApplicationStatePanel, StatusBadge } from "@clockwork/ui";

import type { Translator } from "@/src/i18n";
import { richText } from "@/src/i18n/rich";

import { formatSurfaceTimestamp, type SurfaceFormatting } from "../formatting";
import styles from "./customer-pages.module.css";

/**
 * Counted from the list it introduces.
 *
 * The sentence above the obligations list was the fixed string "Four items need
 * a decision or follow-up." A reader with two obligations was told there were
 * four, and had nowhere to look for the missing two.
 */
function attentionDescription(count: number, t: Translator): string {
  if (count === 0) return t("customer.dashboard.attentionNone");
  return t("customer.dashboard.attentionCount", { count });
}

/**
 * The badge reports the term's own renewal position. An open notice window is
 * the decision that matters, so it outranks the renewal type.
 *
 * `renewalTone` is the loader's statement of that position. The text fallback
 * below reads English words, so it only holds while the loader writes English
 * labels; a loader that localizes the labels must set `renewalTone`.
 */
function renewalTone(
  term: CustomerDashboardProjection["term"],
): "neutral" | "success" | "warning" {
  if (term.renewalTone) return term.renewalTone;
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
    /**
     * The badge tone for the renewal position, from facts: `warning` while the
     * notice window is open or the term expires, `success` for an automatic
     * renewal. Optional only so the loader can adopt it; see `renewalTone`.
     */
    renewalTone?: "neutral" | "success" | "warning";
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
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.taskHeader}>
        <div>
          <h1>{t("customer.dashboard.greeting", { name: greetingName })}</h1>
          <p>{t("customer.dashboard.description")}</p>
        </div>
        {canCreateQuote ? (
          <Link className={styles.primaryLink} href="/quotes/new">
            {t("customer.dashboard.createQuote")}
          </Link>
        ) : (
          <p className={styles.permissionNote}>
            {t("customer.dashboard.quotePermissionNote")}
          </p>
        )}
      </header>

      <section className={styles.obligations} aria-labelledby="attention-title">
        <div className={styles.obligationHeading}>
          <div>
            <h2 id="attention-title">
              {t("customer.dashboard.attentionTitle")}
            </h2>
            <p>{attentionDescription(projection.obligations.length, t)}</p>
          </div>
          <p className={styles.asOf}>
            {richText(
              t,
              projection.stale
                ? "customer.dashboard.staleAsOf"
                : "customer.dashboard.asOf",
              {
                time: (
                  <time dateTime={projection.generatedAt}>
                    {formatSurfaceTimestamp(projection.generatedAt, formatting)}
                  </time>
                ),
              },
            )}
          </p>
        </div>
        {projection.obligations.length === 0 ? (
          <ApplicationStatePanel
            state="empty"
            compact
            title={t("customer.dashboard.noObligations")}
            description={t("customer.dashboard.noObligationsBody")}
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
                <span aria-hidden="true"> {t("customer.link.arrow")}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <div className={styles.commercialGrid}>
        <section className={styles.termCard} aria-labelledby="term-title">
          <div className={styles.termTop}>
            <div>
              <p className={styles.eyebrow}>
                {t("customer.dashboard.agreementEyebrow")}
              </p>
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
              <dt>{t("customer.dashboard.noticeWindow")}</dt>
              <dd>{projection.term.noticeLabel}</dd>
            </div>
            <div>
              <dt>{t("customer.dashboard.renewal")}</dt>
              <dd>{projection.term.renewalLabel}</dd>
            </div>
            <div>
              <dt>{t("customer.dashboard.governingAgreement")}</dt>
              <dd>{projection.term.agreementLabel}</dd>
            </div>
          </dl>
        </section>

        <details className={styles.rollup}>
          <summary>
            <span>{t("customer.dashboard.serviceRollup")}</span>
            <span className={styles.rollupCount}>
              {t("customer.dashboard.serviceCount", {
                count: projection.services.length,
              })}
            </span>
          </summary>
          {projection.services.length === 0 ? (
            <ApplicationStatePanel
              state="empty"
              compact
              title={t("customer.dashboard.noService")}
              description={t("customer.dashboard.noServiceBody")}
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
        <summary>{t("customer.dashboard.usageAndActivity")}</summary>
        <div className={styles.contextColumns}>
          <section aria-labelledby="capacity-facts-title">
            <h2 id="capacity-facts-title">
              {t("customer.dashboard.capacityTitle")}
            </h2>
            {projection.capacity === null ? (
              <ApplicationStatePanel
                state="empty"
                compact
                title={t("customer.dashboard.usageNotConnected")}
                description={t("customer.dashboard.usageNotConnectedBody")}
              />
            ) : (
              <>
                <dl className={styles.capacityFacts}>
                  <div>
                    <dt>{t("customer.dashboard.capacityCommitted")}</dt>
                    <dd>{projection.capacity.committed}</dd>
                  </div>
                  <div>
                    <dt>{t("customer.dashboard.capacityCurrent")}</dt>
                    <dd>{projection.capacity.current}</dd>
                  </div>
                  <div>
                    <dt>{t("customer.dashboard.capacityPrior")}</dt>
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
            <h2 id="activity-title">{t("customer.dashboard.activityTitle")}</h2>
            {projection.activity.length === 0 ? (
              <ApplicationStatePanel
                state="empty"
                compact
                title={t("customer.dashboard.noActivity")}
                description={t("customer.dashboard.noActivityBody")}
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
