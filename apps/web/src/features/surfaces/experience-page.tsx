import type { Route } from "next";
import Link from "next/link";

import { AccountTermRollup, StatusBadge, TermBar } from "@clockwork/ui";

import {
  DEMO_NOW,
  timeline,
  type DemoRecord,
} from "@/src/features/shared/demo-data";
import { plural, t } from "@/src/i18n/en";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

import { DataChart } from "./data-chart";
import { surfaces, type SurfaceKey } from "./surface-catalog";
import { WorkflowPanel } from "./workflow-panel";

function StatGrid({
  stats,
}: {
  stats: (typeof surfaces)[SurfaceKey]["stats"];
}) {
  return (
    <section className="stat-grid" aria-label={t("common.status")}>
      {stats.map((stat) => (
        <article
          className={`stat-tile stat-tile--${stat.tone ?? "neutral"}`}
          key={stat.label}
        >
          <p>{t(stat.label)}</p>
          <strong>{stat.value}</strong>
          <span>{stat.detail}</span>
        </article>
      ))}
    </section>
  );
}

function recordHref(record: DemoRecord, surface: SurfaceKey): Route {
  if (surface === "portfolio" || surface === "partner")
    return `/partner/portfolio/${record.id}` as Route;
  if (surface === "partnerQuotes")
    return `/partner/quotes/${record.id}` as Route;
  if (
    [
      "internal",
      "queues",
      "approvals",
      "provisioning",
      "collections",
      "migrations",
    ].includes(surface)
  ) {
    return `/internal/queues/${record.id}` as Route;
  }
  if (surface === "gates") return "/internal/gates";
  if (record.id.startsWith("Q-")) return `/quotes/${record.id}` as Route;
  return `/orders/${record.id}` as Route;
}

function RecordList({
  records,
  surface,
}: {
  records: readonly DemoRecord[];
  surface: SurfaceKey;
}) {
  return (
    <section className="record-panel" aria-labelledby="records-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{t("table.records")}</p>
          <h2 id="records-title">{t("common.updated")}</h2>
        </div>
        <Link className="text-action" href="/states">
          {t("action.view")}
        </Link>
      </div>
      <div className="record-list">
        {records.map((record) => (
          <article className="record-row" key={record.id}>
            <div className="record-id">
              <span aria-hidden="true" />
              <strong>{record.id}</strong>
            </div>
            <div className="record-main">
              <h3>{record.title}</h3>
              <p>{record.meta}</p>
            </div>
            {record.risk ? (
              <span className={`risk risk--${record.risk}`}>
                {t(`risk.${record.risk}`)}
              </span>
            ) : null}
            <div className="record-value">
              <strong>{record.value}</strong>
              <StatusBadge tone={record.tone}>{t(record.status)}</StatusBadge>
            </div>
            <Link
              href={recordHref(record, surface)}
              className="row-action"
              aria-label={`${t("action.open")}: ${record.title}`}
            >
              →
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

function Timeline() {
  return (
    <section className="timeline-panel" aria-labelledby="timeline-title">
      <p className="eyebrow">{t("dashboard.chain")}</p>
      <h2 id="timeline-title">{t("dashboard.chain")}</h2>
      <ol className="timeline">
        {timeline.map((item) => (
          <li key={item.at}>
            <time>{item.at}</time>
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ExperiencePage({
  surface,
  records: recordsOverride,
}: {
  surface: SurfaceKey;
  records?: readonly DemoRecord[];
}) {
  const config = surfaces[surface];
  const records = recordsOverride ?? config.records;
  const isPartnerSurface = config.eyebrow === "partner.eyebrow";
  return (
    <SurfacePermissionGate
      audience={config.audience}
      requiredPermission={config.permission}
    >
      <main className="experience-main" id="main-content">
        <header className="page-header">
          <div>
            <p className="eyebrow">{t(config.eyebrow)}</p>
            <h1>{t(config.title)}</h1>
            <p className="page-description">{t(config.description)}</p>
          </div>
          <div className="page-actions">
            {config.primaryAction && config.primaryHref ? (
              <Link
                className="cw-button cw-button--primary"
                href={config.primaryHref}
              >
                {t(config.primaryAction)}
              </Link>
            ) : null}
            {surface !== "reports" ? (
              <button
                type="button"
                className="cw-button cw-button--secondary"
                disabled
                title={t("state.partial.description")}
              >
                {t("action.download")}
              </button>
            ) : null}
          </div>
        </header>
        {config.showTerm ? (
          <section className="signature-term" aria-label={t("common.term")}>
            <TermBar
              label={t(isPartnerSurface ? "term.partner" : "term.annual")}
              start={new Date("2026-01-01T00:00:00Z")}
              noticeDate={new Date("2026-11-01T00:00:00Z")}
              end={new Date("2026-12-31T00:00:00Z")}
              now={DEMO_NOW}
              renewalState={isPartnerSurface ? "notice-open" : "auto-renews"}
            />
          </section>
        ) : null}
        {surface === "dashboard" || surface === "renewals" ? (
          <section aria-labelledby="term-rollup-title">
            <h2 className="sr-only" id="term-rollup-title">
              {t("term.rollup")}
            </h2>
            <AccountTermRollup
              label={t("term.rollup")}
              now={DEMO_NOW}
              termCountLabel={(count) =>
                plural(count, t("term.count.one"), t("term.count.other"))
              }
              nextEndLabel={t("term.next")}
              noTermsLabel={t("term.none")}
              terms={[
                {
                  id: "ORD-2026-0098",
                  label: t("term.archive"),
                  start: new Date("2026-01-01T00:00:00Z"),
                  noticeStart: new Date("2026-11-01T00:00:00Z"),
                  end: new Date("2026-12-31T00:00:00Z"),
                  renewalState: "auto-renews",
                },
                {
                  id: "ORD-2026-0112",
                  label: t("term.replica"),
                  start: new Date("2026-07-15T00:00:00Z"),
                  noticeStart: new Date("2026-11-01T00:00:00Z"),
                  end: new Date("2026-12-31T00:00:00Z"),
                  renewalState: "auto-renews",
                },
              ]}
            />
          </section>
        ) : null}
        <StatGrid stats={config.stats} />
        {config.workflow ? (
          <WorkflowPanel workflow={config.workflow} surface={surface} />
        ) : null}
        <div className="content-grid">
          <RecordList records={records} surface={surface} />
          <div className="side-stack">
            {config.chart ? <DataChart kind={config.chart} /> : null}
            <Timeline />
          </div>
        </div>
      </main>
    </SurfacePermissionGate>
  );
}
