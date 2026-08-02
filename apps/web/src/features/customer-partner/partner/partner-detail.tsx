import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { ApplicationStatePanel } from "@clockwork/ui";

import { customerPartnerCopy } from "@/src/features/customer-partner/copy";
import { loadPartnerRecords } from "@/src/features/experience-server/portal-view-loader";
import { getRouteRoles } from "@/src/features/shell/route-session";
import { t } from "@/src/i18n/en";

import type { PartnerRecord, PartnerSurfaceKey } from "./partner-data";
import { currentPartnerRole, validPartnerQuoteActions } from "./partner-rules";
import styles from "./partner.module.css";

const common = customerPartnerCopy.common;
const partnerCopy = customerPartnerCopy.partner;

function MissingRecord({ backHref }: { backHref: Route }) {
  return (
    <main className={styles.main} id="main-content">
      <div className={styles.state}>
        <ApplicationStatePanel
          state="empty"
          title={t("partner.detail.notFound.title")}
          description={t("partner.detail.notFound.description")}
          action={
            <Link className="cw-button cw-button--secondary" href={backHref}>
              {t("partner.detail.notFound.action")}
            </Link>
          }
        />
      </div>
    </main>
  );
}

/**
 * Detail surfaces read the same authorized projection the collection reads, so
 * a record a partner cannot list is a record they cannot open.
 */
async function partnerRecordFor(
  surface: PartnerSurfaceKey,
  recordKey: string,
): Promise<PartnerRecord | undefined> {
  const projection = await loadPartnerRecords(surface);
  return projection.records.find(
    (record) => record.recordKey === recordKey || record.id === recordKey,
  );
}

/**
 * The partner projection carries one commercial position per record, never a
 * separated transfer and resale figure. Both boundaries are labelled so the
 * redaction rule stays visible, and each states that its own number is not
 * recorded rather than borrowing one that belongs to a different record.
 */
function PriceBoundary() {
  const notRecorded = t("partner.detail.notRecorded");
  return (
    <section
      className={styles.boundary}
      aria-label={t("partner.detail.quote.boundary")}
    >
      <div>
        <h2>{partnerCopy.transferPrice}</h2>
        <strong>{notRecorded}</strong>
        <p>{t("partner.detail.transfer.description")}</p>
      </div>
      <div>
        <h2>{partnerCopy.partnerPrice}</h2>
        <strong>{notRecorded}</strong>
        <p>{t("partner.detail.resale.description")}</p>
      </div>
      <div>
        <h2>{partnerCopy.merchantOfRecord}</h2>
        <strong>{notRecorded}</strong>
        <p>{t("partner.detail.merchant.description")}</p>
      </div>
    </section>
  );
}

function CommercialSummary({ record }: { record: PartnerRecord }) {
  return (
    <section className={styles.detailCard}>
      <h2>{common.commercialSummary}</h2>
      <dl>
        <div>
          <dt>{t("partner.detail.position")}</dt>
          <dd>{record.value}</dd>
        </div>
        <div>
          <dt>{t("partner.detail.milestone")}</dt>
          <dd>{record.secondary}</dd>
        </div>
        <div>
          <dt>{t("partner.detail.owner")}</dt>
          <dd>{record.owner}</dd>
        </div>
        <div>
          <dt>{t("partner.detail.risk")}</dt>
          <dd>{record.risk}</dd>
        </div>
      </dl>
      <p className={styles.gate}>{partnerCopy.boundary}</p>
      <ProjectionEvidence record={record} />
    </section>
  );
}

function ProjectionEvidence({ record }: { record: PartnerRecord }) {
  return (
    <details className={styles.technical}>
      <summary>{common.technicalDetails}</summary>
      <p>
        {t("partner.detail.reference")}: <code>{record.id}</code>
      </p>
      {record.projectionId ? (
        <p>
          {t("partner.detail.projection.record")}:{" "}
          <code>{record.projectionId}</code>
        </p>
      ) : null}
      {record.recordVersion === undefined ? null : (
        <p>
          {t("partner.detail.projection.version")}:{" "}
          <code>{record.recordVersion}</code>
        </p>
      )}
    </details>
  );
}

export async function PartnerPortfolioDetail({
  id,
  actions,
}: {
  id: string;
  /**
   * Server-backed action for this end client, supplied by the route so the
   * panel carries the route's own permission gate rather than a second guess
   * at it.
   */
  actions?: ReactNode;
}) {
  const record = await partnerRecordFor("portfolio", id);
  if (!record) return <MissingRecord backHref="/partner/portfolio" />;
  return (
    <main className={styles.main} id="main-content">
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/partner">{t("partner.title")}</Link>
        <span>/</span>
        <Link href="/partner/portfolio">{t("partner.portfolio.title")}</Link>
        <span>/</span>
        <span aria-current="page">{record.name}</span>
      </nav>
      <header className={styles.detailHeading}>
        <div>
          <p className={styles.eyebrow}>
            {t("partner.detail.portfolio.eyebrow")}
          </p>
          <h1>{record.name}</h1>
          <p className={styles.muted}>{record.context}</p>
        </div>
        <span className={styles.pill} data-tone={record.status}>
          {record.status}
        </span>
      </header>
      <section className={styles.term} aria-labelledby="client-term-title">
        <div className={styles.termHeader}>
          <div>
            <p className={styles.eyebrow}>{common.termState}</p>
            <h2 id="client-term-title">{t("partner.detail.portfolio.term")}</h2>
          </div>
          <strong>{record.secondary}</strong>
        </div>
        <ApplicationStatePanel
          state="partial"
          compact
          title={t("partner.detail.term.unavailable.title")}
          description={t("partner.detail.term.unavailable.description")}
        />
      </section>
      <PriceBoundary />
      <div className={styles.detailsGrid}>
        <section className={styles.detailCard}>
          <h2>{common.nextAction}</h2>
          <dl>
            <div>
              <dt>{t("partner.detail.milestone")}</dt>
              <dd>{record.secondary}</dd>
            </div>
            <div>
              <dt>{t("partner.detail.owner")}</dt>
              <dd>{record.owner}</dd>
            </div>
          </dl>
        </section>
        <CommercialSummary record={record} />
      </div>
      {actions}
    </main>
  );
}

export async function PartnerQuoteDetail({ id }: { id: string }) {
  const [record, roles] = await Promise.all([
    partnerRecordFor("quotes", id),
    getRouteRoles("partner"),
  ]);
  if (!record) return <MissingRecord backHref="/partner/quotes" />;
  const role = currentPartnerRole(roles) ?? "partner_seller";
  const actions = validPartnerQuoteActions(record.status, role);
  return (
    <main className={styles.main} id="main-content">
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/partner">{t("partner.title")}</Link>
        <span>/</span>
        <Link href="/partner/quotes">{t("partner.quotes.title")}</Link>
        <span>/</span>
        <span aria-current="page">{record.name}</span>
      </nav>
      <header className={styles.detailHeading}>
        <div>
          <p className={styles.eyebrow}>{t("partner.detail.quote.eyebrow")}</p>
          <h1>{record.name}</h1>
          <p className={styles.muted}>{record.context}</p>
        </div>
        <span className={styles.pill} data-tone={record.status}>
          {record.status}
        </span>
      </header>
      <PriceBoundary />
      <section className={styles.summary} aria-labelledby="valid-actions-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>{common.nextAction}</p>
            <h2 id="valid-actions-title">
              {t("partner.detail.quote.actions")}
            </h2>
          </div>
        </div>
        <div className={styles.actions}>
          {actions.includes("edit") ? (
            <Link className={styles.buttonLink} href="/partner/quotes/new">
              {t("partner.detail.quote.edit")}
            </Link>
          ) : null}
          {actions.includes("revise") ? (
            <Link className={styles.buttonLink} href="/partner/quotes/new">
              {t("partner.detail.quote.revise")}
            </Link>
          ) : null}
        </div>
        {actions.includes("issue") ? (
          <p className={styles.gate}>
            <strong>{t("partner.detail.quote.issue.title")}:</strong>{" "}
            {t("partner.detail.quote.issue.description")}
          </p>
        ) : null}
        {actions.includes("cancel") ? (
          <p className={styles.gate}>
            <strong>{t("partner.detail.quote.cancel.title")}:</strong>{" "}
            {t("partner.detail.quote.cancel.description")}
          </p>
        ) : null}
        {actions.includes("download") ? (
          <p className={styles.gate}>
            <strong>{t("partner.detail.quote.download.title")}:</strong>{" "}
            {t("partner.detail.quote.download.description")}
          </p>
        ) : null}
      </section>
      <div className={styles.detailsGrid}>
        <CommercialSummary record={record} />
      </div>
    </main>
  );
}
