"use client";
import { useTranslations } from "@/src/i18n/client";
import { localizeCopy } from "@/src/i18n/copy";

import { useState } from "react";

import { Button, Select, StatusBadge, Table } from "@clockwork/ui";

import {
  downloadReportCsv,
  reportNames,
  type ReportName,
} from "@/src/features/contracts/commerce-client";
import { plural } from "@/src/i18n/en";
import { formatOperationalTimestamp } from "../presentation";

import { lifecycleCopy } from "./copy";
import { FinancePageFrame } from "./page-frame";
import type { SurfaceProvenance } from "./provenance";
import type {
  ReportAccountOption,
  ReportExportRecord,
} from "./reports-projection";
import styles from "./finance-lifecycle.module.css";

const copy = lifecycleCopy.reports;

function label(name: string): string {
  const override = copy.labels[name as keyof typeof copy.labels];
  if (override) return override;
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusTone(
  status: string | null,
): "neutral" | "warning" | "success" | "danger" {
  if (status === "complete") return "success";
  if (status === "canceled" || status === "blocked") return "danger";
  if (status === "pending" || status === "attention") return "warning";
  return "neutral";
}

export function ReportsView({
  exports: exportRecords,
  accounts,
  provenance,
}: {
  exports: readonly ReportExportRecord[];
  accounts: readonly ReportAccountOption[];
  provenance: SurfaceProvenance;
}) {
  const t = useTranslations();
  const localizedcopy = localizeCopy(copy, t);
  const [selectedReport, setSelectedReport] = useState("");
  const [accountId, setAccountId] = useState("");
  const [exporting, setExporting] = useState<ReportName | null>(null);
  const [message, setMessage] = useState<
    { tone: "status" | "alert"; text: string } | undefined
  >();
  const selectedAccount = accounts.find((account) => account.id === accountId);
  /**
   * One filter over both lists on the page, because both are keyed by the same
   * registry name: a recorded export states the report it ran under, and the
   * catalogue is the registry itself. A recorded export whose projection names
   * no report is filtered out along with the others -- it is not evidence of
   * the selected report either.
   */
  const visibleExports = selectedReport
    ? exportRecords.filter((record) => record.report === selectedReport)
    : exportRecords;
  const visibleReports = selectedReport
    ? reportNames.filter((report) => report === selectedReport)
    : reportNames;

  async function exportReport(report: ReportName) {
    setExporting(report);
    setMessage(undefined);
    try {
      const csv = await downloadReportCsv({
        report,
        ...(accountId ? { accountId } : {}),
      });
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${report}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage({
        tone: "status",
        text: `${label(report)} export downloaded for ${selectedAccount?.label ?? "all accounts in your scope"}.`,
      });
    } catch {
      setMessage({
        tone: "alert",
        text: "The export could not be generated. Nothing on this page changed.",
      });
    } finally {
      setExporting(null);
    }
  }

  return (
    <FinancePageFrame
      title={localizedcopy.title}
      description={localizedcopy.description}
      provenance={provenance}
    >
      <form
        className={styles.filterBar}
        aria-label="Report filters"
        onSubmit={(event) => event.preventDefault()}
      >
        <Select
          label="Report"
          name="report"
          value={selectedReport}
          onChange={(event) => setSelectedReport(event.currentTarget.value)}
          options={[
            { value: "", label: localizedcopy.allReports },
            ...reportNames.map((report) => ({
              value: report,
              label: label(report),
            })),
          ]}
          help="The report registry in the commerce contract. Filters both the recorded exports and the exports offered below."
        />
      </form>

      <section className={styles.section} aria-labelledby="recorded-exports">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="recorded-exports">{localizedcopy.exportsHeading}</h2>
            <p>{localizedcopy.exportsCaption}</p>
          </div>
          <span className={styles.sectionMeta}>
            {plural(visibleExports.length, "{count} export", "{count} exports")}
          </span>
        </header>
        {exportRecords.length === 0 ? (
          <p className={styles.empty}>{localizedcopy.exportsEmpty}</p>
        ) : visibleExports.length === 0 ? (
          <p className={styles.empty}>
            {localizedcopy.exportsFilterEmpty(label(selectedReport))}
          </p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={localizedcopy.exportsCaption}
            captionHidden
            density="compact"
            headers={["Report", "Status", "Document", "Recorded"]}
            rowKeys={visibleExports.map((record) => record.id)}
            rows={visibleExports.map((record) => [
              <div className={styles.primaryCell}>
                <strong>{record.title}</strong>
                <details className={styles.disclosure}>
                  <summary>Technical evidence</summary>
                  <p className={styles.id}>{record.aggregateId}</p>
                  {record.evidence.map((entry) => (
                    <p key={`${entry.label}-${entry.value}`}>
                      {entry.label}: {entry.value}
                    </p>
                  ))}
                </details>
              </div>,
              <StatusBadge tone={statusTone(record.status)}>
                {record.statusLabel}
              </StatusBadge>,
              record.documentId ? (
                <span className={styles.id}>{record.documentId}</span>
              ) : (
                localizedcopy.documentPending
              ),
              <time dateTime={record.updatedAt}>
                {formatOperationalTimestamp(record.updatedAt)}
              </time>,
            ])}
          />
        )}
      </section>

      <section className={styles.section} aria-labelledby="supported-exports">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="supported-exports">{localizedcopy.catalogueHeading}</h2>
            <p>{localizedcopy.catalogueDescription}</p>
          </div>
        </header>

        <form
          className={styles.filterBar}
          aria-label="Export scope"
          onSubmit={(event) => event.preventDefault()}
        >
          <Select
            label={t("nav.account")}
            name="accountId"
            value={accountId}
            onChange={(event) => setAccountId(event.currentTarget.value)}
            options={[
              { value: "", label: "All accounts in your scope" },
              ...accounts.map((account) => ({
                value: account.id,
                label: account.label,
              })),
            ]}
            help="Accounts projected into your operator session. The export request submits the account ID."
          />
        </form>

        {accountId ? (
          <details className={styles.disclosure}>
            <summary>Selected account evidence</summary>
            <p>
              {selectedAccount?.label} · submitted account ID{" "}
              <span className={styles.id}>{accountId}</span>
            </p>
          </details>
        ) : null}

        {message ? (
          <p
            className={
              message.tone === "alert" ? styles.blocked : styles.statusMessage
            }
            role={message.tone}
          >
            {message.text}
          </p>
        ) : null}

        <div className={styles.reportList}>
          {visibleReports.map((report) => (
            <article className={styles.reportCard} key={report}>
              <div>
                <h3>{label(report)}</h3>
                <p className={styles.secondary}>{report}</p>
              </div>
              <div className={styles.reportActions}>
                <Button
                  variant="secondary"
                  size="small"
                  loading={exporting === report}
                  loadingLabel="Exporting…"
                  onClick={() => void exportReport(report)}
                >
                  Export CSV
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </FinancePageFrame>
  );
}
