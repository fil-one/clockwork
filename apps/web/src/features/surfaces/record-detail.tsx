import type { Route } from "next";
import Link from "next/link";

import {
  DescriptionList,
  DocumentCard,
  StatusBadge,
  TermBar,
  Timeline,
} from "@clockwork/ui";

import {
  DEMO_NOW,
  agreements,
  endClients,
  invoices,
  orders,
  pocs,
  queues,
  quotes,
  timeline,
  type DemoRecord,
} from "@/src/features/shared/demo-data";
import { t } from "@/src/i18n/en";

const allRecords: readonly DemoRecord[] = [
  ...agreements,
  ...quotes,
  ...orders,
  ...pocs,
  ...invoices,
  ...endClients,
  ...queues,
];

export function RecordDetailPage({
  id,
  backHref,
}: {
  id: string;
  backHref: Route;
}) {
  const record = allRecords.find((candidate) => candidate.id === id) ?? {
    id,
    title: "Northstar Archive Labs",
    meta: t("detail.unknown"),
    status: "status.review" as const,
    tone: "warning" as const,
    value: t("common.updated"),
  };
  return (
    <main className="experience-main" id="main-content">
      <nav aria-label={t("action.open")}>
        <Link href={backHref}>← {t("action.view")}</Link>
      </nav>
      <header className="page-header">
        <div>
          <p className="eyebrow">{t("detail.eyebrow")}</p>
          <h1>{record.title}</h1>
          <p className="page-description">{t("detail.description")}</p>
        </div>
        <div className="page-actions">
          <StatusBadge tone={record.tone}>{t(record.status)}</StatusBadge>
          <button
            className="cw-button cw-button--secondary"
            type="button"
            disabled
            title={t("state.partial.description")}
          >
            {t("action.download")}
          </button>
        </div>
      </header>
      <section className="signature-term">
        <TermBar
          label={`${record.id} · ${record.title}`}
          start={new Date("2026-01-01T00:00:00Z")}
          noticeStart={new Date("2026-11-01T00:00:00Z")}
          end={new Date("2026-12-31T00:00:00Z")}
          now={DEMO_NOW}
          variant="table"
        />
      </section>
      <section
        className="record-panel detail-panel"
        aria-labelledby="provenance-title"
      >
        <div className="section-heading">
          <h2 id="provenance-title">{t("detail.provenance")}</h2>
        </div>
        <DescriptionList
          columns={4}
          items={[
            { term: t("common.reference"), detail: record.id },
            {
              term: t("detail.upstream"),
              detail: record.id.startsWith("Q-")
                ? "PB-USD-2026.3"
                : "Q-2026-0184-v3",
            },
            { term: t("detail.version"), detail: "v3" },
            { term: t("detail.hash"), detail: "sha256: 73be…9f02" },
          ]}
        />
      </section>
      <div className="content-grid">
        <section
          className="record-panel document-section"
          aria-labelledby="document-title"
        >
          <div className="section-heading">
            <h2 id="document-title">{t("detail.documents")}</h2>
          </div>
          <DocumentCard
            title={record.title}
            type={t("common.reference")}
            documentId={record.id}
            version="v3 · sha256 73be…9f02"
            updated={t("common.updated")}
            status={
              <StatusBadge tone="success">{t("status.ready")}</StatusBadge>
            }
            summary={record.meta}
            actions={
              <button
                className="text-action"
                type="button"
                disabled
                title={t("state.partial.description")}
              >
                {t("action.download")}
              </button>
            }
          />
        </section>
        <section className="timeline-panel" aria-labelledby="audit-title">
          <p className="eyebrow">{t("detail.audit")}</p>
          <h2 id="audit-title">{t("detail.audit")}</h2>
          <Timeline
            label={t("detail.audit")}
            items={timeline.map((item, index) => ({
              id: String(index),
              title: item.title,
              description: item.detail,
              timestamp: item.at,
              status: index === 0 ? "current" : "complete",
            }))}
          />
        </section>
      </div>
    </main>
  );
}
