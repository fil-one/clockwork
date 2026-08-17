import Link from "next/link";
import type { Route } from "next";

import { TermBar, type RenewalState } from "@clockwork/ui";

import { customerPartnerCopy } from "@/src/features/customer-partner/copy";
import {
  formatSurfaceTimestamp,
  type SurfaceFormatting,
} from "@/src/features/customer-partner/formatting";
import { t } from "@/src/i18n/en";

import { currentPartnerRole } from "./partner-rules";
import styles from "./partner.module.css";

export interface PartnerDashboardProjection {
  generatedAt: string;
  stale: boolean;
  agreement: {
    label: string;
    start: string;
    noticeStart: string;
    end: string;
    now: string;
    renewalState: RenewalState;
    authorityState: string;
    nextDecision: string;
    commercialRoute: string;
    merchantBoundary: string;
  };
  work: readonly {
    id: string;
    account: string;
    task: string;
    evidence: string;
    due: string;
    href: Route;
    adminOnly: boolean;
    recordVersion: number;
  }[];
  commission?: {
    id: string;
    statement: string;
    accruedAmount: string;
    href: Route;
  };
  boundary: readonly { label: string; value: string }[];
}

export function PartnerDashboard({
  projection,
  roles,
  formatting,
}: {
  projection: PartnerDashboardProjection;
  roles: readonly string[];
  /** Locale and zone of the partner reading, from the active route session. */
  formatting: SurfaceFormatting;
}) {
  const copy = customerPartnerCopy.partner;
  const isAdmin = currentPartnerRole(roles) === "partner_admin";
  const visibleWork = projection.work.filter(
    (item) => isAdmin || !item.adminOnly,
  );

  return (
    <main className={styles.main} id="main-content">
      <header className={styles.taskHeader}>
        <div>
          <h1>{copy.deskTitle}</h1>
          <p>{copy.deskDescription}</p>
          <p className={styles.projectionFreshness}>
            {projection.stale
              ? "Stale projection from "
              : "Projection refreshed "}
            <time dateTime={projection.generatedAt}>
              {formatSurfaceTimestamp(projection.generatedAt, formatting)}
            </time>
          </p>
        </div>
        <Link className={styles.buttonLink} href="/partner/quotes/new">
          Create resale quote
        </Link>
      </header>

      <section
        className={styles.authority}
        aria-labelledby="agreement-clock-title"
      >
        <div className={styles.authorityHeading}>
          <div>
            <p className={styles.classifier}>Commercial authority</p>
            <h2 id="agreement-clock-title">{copy.agreementClock}</h2>
          </div>
          <p className={styles.authorityState}>
            <strong>{projection.agreement.authorityState}</strong>
          </p>
        </div>
        <TermBar
          label={projection.agreement.label}
          start={new Date(projection.agreement.start)}
          noticeStart={new Date(projection.agreement.noticeStart)}
          end={new Date(projection.agreement.end)}
          now={new Date(projection.agreement.now)}
          renewalState={projection.agreement.renewalState}
          // The agreement clock decides a notice deadline. Rendered in the
          // component's `en-US`/UTC defaults it stated one day for a London
          // partner and another for the same partner's calendar.
          locale={formatting.locale}
          timeZone={formatting.timeZone}
        />
        <dl className={styles.authorityFacts}>
          <div>
            <dt>Next decision</dt>
            <dd>{projection.agreement.nextDecision}</dd>
          </div>
          <div>
            <dt>Commercial route</dt>
            <dd>{projection.agreement.commercialRoute}</dd>
          </div>
          <div>
            <dt>Merchant boundary</dt>
            <dd>{projection.agreement.merchantBoundary}</dd>
          </div>
        </dl>
      </section>

      {isAdmin && projection.commission ? (
        <section
          className={styles.commissionPosition}
          aria-labelledby="commission-position-title"
        >
          <div>
            <p className={styles.classifier}>Collected-revenue position</p>
            <h2 id="commission-position-title">Commission position</h2>
            <p>{t("partner.commissions.description")}</p>
          </div>
          <dl>
            <div>
              <dt>Accrued amount</dt>
              <dd>{projection.commission.accruedAmount}</dd>
            </div>
            <div>
              <dt>Statement</dt>
              <dd>{projection.commission.statement}</dd>
            </div>
          </dl>
          <Link href={projection.commission.href}>
            Open {projection.commission.statement}
          </Link>
        </section>
      ) : null}

      <section
        className={styles.workLedger}
        aria-labelledby="urgent-partner-title"
      >
        <div className={styles.ledgerHeading}>
          <div>
            <h2 id="urgent-partner-title">{copy.urgentTitle}</h2>
            <p>Named work ordered by protection deadline and consequence.</p>
          </div>
          <p className={styles.count}>{visibleWork.length} actions</p>
        </div>
        <div
          className={styles.ledgerScroll}
          tabIndex={0}
          role="region"
          aria-label="Urgent partner work table"
        >
          <table className={styles.ledger}>
            <thead>
              <tr>
                <th scope="col">End client or account</th>
                <th scope="col">Next task</th>
                <th scope="col">Required evidence</th>
                <th scope="col">Due / exposure</th>
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleWork.map((item) => (
                <tr key={item.id}>
                  <th scope="row">{item.account}</th>
                  <td>{item.task}</td>
                  <td>{item.evidence}</td>
                  <td>
                    <strong>{item.due}</strong>
                  </td>
                  <td>
                    <Link
                      href={item.href}
                      data-record-version={item.recordVersion}
                    >
                      Open record
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        className={styles.boundary}
        aria-labelledby="commercial-boundary-title"
      >
        <div>
          <h2 id="commercial-boundary-title">Commercial boundary</h2>
          <p>{copy.boundary}</p>
        </div>
        <dl>
          {projection.boundary.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
