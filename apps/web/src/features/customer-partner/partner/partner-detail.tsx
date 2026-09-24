import { PartnerQuoteControls } from "./partner-quote-controls";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { use } from "react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  ApplicationStatePanel,
  Breadcrumbs,
  buttonClassName,
} from "@clockwork/ui";

import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";
import { loadPartnerRecords } from "@/src/features/experience-server/portal-view-loader";
import {
  getRouteIdentity,
  getRouteRoles,
} from "@/src/features/shell/route-session";

import type { PartnerRecord, PartnerSurfaceKey } from "./partner-data";
import { currentPartnerRole, validPartnerQuoteActions } from "./partner-rules";
import { PartnerQuoteIssue } from "./partner-quote-issue";
import { demoPartnerQuoteRecord } from "./demo-partner-quote";
import styles from "./partner.module.css";

function MissingRecord({ backHref }: { backHref: Route }) {
  const t = use(getTranslations());
  return (
    <main className={styles.main} id="main-content">
      <div className={styles.state}>
        <ApplicationStatePanel
          state="empty"
          title={t("partner.detail.notFound.title")}
          description={t("partner.detail.notFound.description")}
          action={
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href={backHref}
            >
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
  if (surface === "quotes" && demoDeployIdentityEnabled(process.env)) {
    const identity = await getRouteIdentity("partner");
    const created = demoPartnerQuoteRecord(
      await configuredDemoStateStore().read(),
      identity.accountId,
      recordKey,
    );
    if (created) return created;
  }
  const projection = await loadPartnerRecords(surface);
  return projection.records.find(
    (record) => record.recordKey === recordKey || record.id === recordKey,
  );
}

/** Show separated prices only when the authorized record supplies both. */
function PriceBoundary({
  pricing,
}: {
  pricing?: PartnerRecord["quotePricing"];
}) {
  const t = use(getTranslations());
  return (
    <section
      className={styles.boundary}
      aria-label={t("partner.detail.quote.boundary")}
    >
      <div>
        <h2>{t("cp.partner.transferPrice")}</h2>
        {pricing ? <strong>{pricing.transferPrice}</strong> : null}
        <p>{t("partner.detail.transfer.description")}</p>
      </div>
      <div>
        <h2>{t("cp.partner.partnerPrice")}</h2>
        {pricing ? <strong>{pricing.resalePrice}</strong> : null}
        <p>{t("partner.detail.resale.description")}</p>
      </div>
      <div>
        <h2>{t("cp.partner.merchantOfRecord")}</h2>
        <p>{t("partner.detail.merchant.description")}</p>
      </div>
    </section>
  );
}

function CommercialSummary({ record }: { record: PartnerRecord }) {
  const t = use(getTranslations());
  return (
    <section className={styles.detailCard}>
      <h2>{t("common.commercialSummary")}</h2>
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
      <p className={styles.gate}>{t("cp.partner.boundary")}</p>
      <ProjectionEvidence record={record} />
    </section>
  );
}

function ProjectionEvidence({ record }: { record: PartnerRecord }) {
  const t = use(getTranslations());
  return (
    <details className={styles.technical}>
      <summary>{t("common.technicalDetails")}</summary>
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
  const t = await getTranslations();
  const record = await partnerRecordFor("portfolio", id);
  if (!record) return <MissingRecord backHref="/partner/portfolio" />;
  return (
    <main className={styles.main} id="main-content">
      <Breadcrumbs
        items={[
          { label: t("partner.title"), href: "/partner" },
          { label: t("partner.portfolio.title"), href: "/partner/portfolio" },
          { label: record.name },
        ]}
        renderLink={(href, label) => <Link href={href as Route}>{label}</Link>}
      />
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
            <p className={styles.eyebrow}>{t("common.termState")}</p>
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
      <PriceBoundary pricing={record.quotePricing} />

      <div className={styles.detailsGrid}>
        <section className={styles.detailCard}>
          <h2>{t("common.nextAction")}</h2>
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
  const t = await getTranslations();
  const formattingLocale = await getFormattingLocale();
  const [record, roles] = await Promise.all([
    partnerRecordFor("quotes", id),
    getRouteRoles("partner"),
  ]);
  if (!record) return <MissingRecord backHref="/partner/quotes" />;
  const role = currentPartnerRole(roles) ?? "partner_seller";
  const actions = validPartnerQuoteActions(record.status, role).filter(
    (action) =>
      !record.allowedActions || record.allowedActions.includes(action),
  );
  return (
    <main className={styles.main} id="main-content">
      <Breadcrumbs
        items={[
          { label: t("partner.title"), href: "/partner" },
          { label: t("partner.quotes.title"), href: "/partner/quotes" },
          { label: record.name },
        ]}
        renderLink={(href, label) => <Link href={href as Route}>{label}</Link>}
      />
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
      <PriceBoundary pricing={record.quotePricing} />
      {record.orderId ? (
        <section className={styles.detailCard}>
          <h2>Supply order</h2>
          <Link href={`/partner/orders/${record.orderId}` as Route}>
            Track your supply order
          </Link>
        </section>
      ) : record.quoteCommand &&
        record.status === "open" &&
        role === "partner_admin" ? (
        <section className={styles.detailCard}>
          <h2>Order from Fil One</h2>
          <p>
            Review and accept the supply order at your confidential transfer
            price. Your client contract and resale billing remain your
            responsibility.
          </p>
          <Link
            className={styles.buttonLink}
            href={
              `/partner/quotes/${encodeURIComponent(record.id)}/order` as Route
            }
          >
            Review supply order
          </Link>
        </section>
      ) : null}
      {record.clientResponse ? (
        <section className={styles.detailCard}>
          <h2>Client response</h2>
          <p>
            {record.clientResponse.decision === "request_order"
              ? "Purchase request received. Confirm the order terms with your client before placing the supply order."
              : record.clientResponse.decision === "request_changes"
                ? "Changes requested. Prepare a revised quote and share the new version."
                : "The client declined this quote."}
          </p>
          <p>
            {record.clientResponse.name} ·{" "}
            {new Date(record.clientResponse.at).toLocaleString(
              formattingLocale,
            )}
          </p>
          <p>{record.clientResponse.note}</p>
        </section>
      ) : null}
      {record.quoteCommand ? (
        <PartnerQuoteControls
          command={record.quoteCommand}
          canShare={record.status === "open"}
          canCancel={actions.includes("cancel")}
        />
      ) : (
        <section className={styles.detailCard}>
          <h2>Example quote</h2>
          <p>
            This walkthrough record has no editable source. Create a priced
            quote from your current catalogue to edit, issue documents, and
            collect a client response.
          </p>
          <Link href="/partner/quotes/new">Create a priced quote</Link>
        </section>
      )}
      {record.documents?.length ? (
        <section className={styles.detailCard} aria-label="Issued documents">
          <h2>Issued documents</h2>
          <p>
            Send only the end-client quotation to your client. Keep the transfer
            quote within your commercial team.
          </p>
          <div className={styles.actions}>
            {record.documents.map((document) => (
              <a
                key={document.id}
                className={styles.buttonLink}
                href={`/api/experience/artifacts/${document.kind}/${document.id}`}
              >
                {document.label} · PDF
              </a>
            ))}
          </div>
        </section>
      ) : null}
      <section className={styles.summary} aria-labelledby="valid-actions-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>{t("common.nextAction")}</p>
            <h2 id="valid-actions-title">
              {t("partner.detail.quote.actions")}
            </h2>
          </div>
        </div>
        <div className={styles.actions}>
          {actions.includes("edit") || actions.includes("revise") ? (
            <Link
              className={styles.buttonLink}
              href={
                record.quoteCommand
                  ? (`/partner/quotes/new?revises=${encodeURIComponent(record.id)}` as Route)
                  : "/partner/quotes/new"
              }
            >
              {record.quoteCommand
                ? record.status === "draft"
                  ? "Edit draft"
                  : "Create revised quote"
                : "Create a new quote"}
            </Link>
          ) : null}
        </div>
        {actions.includes("issue") && record.quoteCommand ? (
          <PartnerQuoteIssue command={record.quoteCommand} />
        ) : actions.includes("issue") ? (
          <p className={styles.gate}>
            <strong>{t("partner.detail.quote.issue.title")}:</strong>{" "}
            {t("partner.detail.quote.issue.description")}{" "}
            <Link href="/partner/support">{t("nav.partner.support")}</Link>
          </p>
        ) : null}
        {actions.includes("cancel") && !record.quoteCommand ? (
          <p className={styles.gate}>
            <strong>{t("partner.detail.quote.cancel.title")}:</strong>{" "}
            {t("partner.detail.quote.cancel.description")}
          </p>
        ) : null}
        {actions.includes("download") && !record.documents?.length ? (
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
