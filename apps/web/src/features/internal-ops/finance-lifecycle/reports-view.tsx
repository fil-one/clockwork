"use client";
import type { MessageId, Translator } from "@/src/i18n";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import { richText } from "@/src/i18n/rich";

import { useState } from "react";

import { Button, Select, StatusBadge, Table } from "@clockwork/ui";

import {
  downloadReportCsv,
  reportNames,
  type ReportName,
} from "@/src/features/contracts/commerce-client";
import { formatOperationalTimestamp } from "../presentation";

import { lifecycleCopy } from "./copy";
import { FinancePageFrame, IdentifierLine, RecordEvidence } from "./page-frame";
import { statusText } from "./projection-fields";
import type { SurfaceProvenance } from "./provenance";
import type {
  ReportAccountOption,
  ReportExportRecord,
} from "./reports-projection";
import styles from "./finance-lifecycle.module.css";

const copy = lifecycleCopy.reports;

/** Every report the commerce contract's registry names, worded. */
const reportLabels = copy.names satisfies Readonly<
  Record<ReportName, MessageId>
>;

function label(t: Translator, name: string): string {
  const id = reportLabels[name as ReportName];
  return id ? t(id) : name;
}

function accountLabel(t: Translator, account: ReportAccountOption): string {
  return account.description
    ? t("common.join.labels", {
        first: account.reference,
        second: account.description,
      })
    : account.reference;
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
  const formattingLocale = useFormattingLocale();
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
        text: selectedAccount
          ? t(copy.downloadedForAccount, {
              report: label(t, report),
              account: accountLabel(t, selectedAccount),
            })
          : t(copy.downloadedForScope, { report: label(t, report) }),
      });
    } catch {
      setMessage({ tone: "alert", text: t(copy.exportFailed) });
    } finally {
      setExporting(null);
    }
  }

  return (
    <FinancePageFrame
      title={t(copy.title)}
      description={t(copy.description)}
      provenance={provenance}
    >
      <form
        className={styles.filterBar}
        aria-label={t(copy.filtersLabel)}
        onSubmit={(event) => event.preventDefault()}
      >
        <Select
          label={t(copy.reportLabel)}
          name="report"
          value={selectedReport}
          onChange={(event) => setSelectedReport(event.currentTarget.value)}
          options={[
            { value: "", label: t(copy.allReports) },
            ...reportNames.map((report) => ({
              value: report,
              label: label(t, report),
            })),
          ]}
          help={t(copy.reportHelp)}
        />
      </form>

      <section className={styles.section} aria-labelledby="recorded-exports">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="recorded-exports">{t(copy.exportsHeading)}</h2>
            <p>{t(copy.exportsCaption)}</p>
          </div>
          <span className={styles.sectionMeta}>
            {t(copy.exportCount, { count: visibleExports.length })}
          </span>
        </header>
        {exportRecords.length === 0 ? (
          <p className={styles.empty}>{t(copy.exportsEmpty)}</p>
        ) : visibleExports.length === 0 ? (
          <p className={styles.empty}>
            {t(copy.exportsFilterEmpty, {
              report: label(t, selectedReport),
            })}
          </p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={t(copy.exportsCaption)}
            captionHidden
            density="compact"
            headers={[
              t(copy.columns.report),
              t("common.status"),
              t(copy.columns.document),
              t(copy.columns.recorded),
            ]}
            rowKeys={visibleExports.map((record) => record.id)}
            rows={visibleExports.map((record) => [
              <div className={styles.primaryCell}>
                <strong>{record.title}</strong>
                <details className={styles.disclosure}>
                  <summary>{t(lifecycleCopy.evidence.technical)}</summary>
                  <IdentifierLine
                    label={lifecycleCopy.evidence.recordId}
                    value={record.aggregateId}
                  />
                  <RecordEvidence
                    entries={record.evidence}
                    version={record.version}
                    updatedAt={record.updatedAt}
                  />
                </details>
              </div>,
              <StatusBadge tone={statusTone(record.status)}>
                {statusText(t, [record.status], record.statusLabel)}
              </StatusBadge>,
              record.documentId ? (
                <span className={styles.id}>{record.documentId}</span>
              ) : (
                t(copy.documentPending)
              ),
              <time dateTime={record.updatedAt}>
                {formatOperationalTimestamp(record.updatedAt, formattingLocale)}
              </time>,
            ])}
          />
        )}
      </section>

      <section className={styles.section} aria-labelledby="supported-exports">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="supported-exports">{t(copy.catalogueHeading)}</h2>
            <p>{t(copy.catalogueDescription)}</p>
          </div>
        </header>

        <form
          className={styles.filterBar}
          aria-label={t(copy.scopeLabel)}
          onSubmit={(event) => event.preventDefault()}
        >
          <Select
            label={t("recordKind.account")}
            name="accountId"
            value={accountId}
            onChange={(event) => setAccountId(event.currentTarget.value)}
            options={[
              { value: "", label: t(copy.allAccounts) },
              ...accounts.map((account) => ({
                value: account.id,
                label: accountLabel(t, account),
              })),
            ]}
            help={t(copy.accountHelp)}
          />
        </form>

        {selectedAccount ? (
          <details className={styles.disclosure}>
            <summary>{t(copy.selectedAccountEvidence)}</summary>
            <p>
              {richText(t, copy.submittedAccount, {
                account: accountLabel(t, selectedAccount),
                id: <span className={styles.id}>{accountId}</span>,
              })}
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
                <h3>{label(t, report)}</h3>
                {/* The registry name the export API and the CSV file use. */}
                <p className={styles.secondary}>{report}</p>
              </div>
              <div className={styles.reportActions}>
                <Button
                  variant="secondary"
                  size="small"
                  loading={exporting === report}
                  loadingLabel={t(copy.exporting)}
                  onClick={() => void exportReport(report)}
                >
                  {t(copy.exportCsv)}
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </FinancePageFrame>
  );
}
