"use client";

import { useState } from "react";

import { Button, Select, StatusBadge } from "@clockwork/ui";

import {
  downloadReportCsv,
  type ReportName,
} from "@/src/features/contracts/commerce-client";

import { lifecycleCopy } from "./copy";
import {
  accountOptions,
  reportCatalog,
  reportMetrics,
  type ValueState,
} from "./lifecycle-data";
import { formatMoney } from "./lifecycle-logic";
import { FinancePageFrame } from "./page-frame";
import styles from "./finance-lifecycle.module.css";

function stateTone(state: ValueState): "success" | "warning" | "neutral" {
  if (state === "Final") return "success";
  if (state === "Pending reconciliation") return "warning";
  return "neutral";
}

function RevenueChart() {
  const maximum = Math.max(
    ...reportMetrics.flatMap((metric) => [
      metric.estimatedCents,
      metric.reconciledCents ?? 0,
    ]),
  );
  const points = reportMetrics.map((metric, index) => ({
    ...metric,
    x: 22 + index * 74,
    estimatedY: 128 - (metric.estimatedCents / maximum) * 100,
    reconciledY:
      metric.reconciledCents === null
        ? null
        : 128 - (metric.reconciledCents / maximum) * 100,
  }));
  const estimatedPath = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${point.x},${point.estimatedY}`,
    )
    .join(" ");
  const reconciledPath = points
    .filter(
      (point): point is typeof point & { reconciledY: number } =>
        point.reconciledY !== null,
    )
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${point.x},${point.reconciledY}`,
    )
    .join(" ");

  return (
    <section className={styles.panel} aria-labelledby="report-chart-title">
      <header className={styles.panelHeader}>
        <div>
          <h2 id="report-chart-title">Revenue estimate vs reconciled truth</h2>
          <p>July remains pending reconciliation.</p>
        </div>
      </header>
      <div className={styles.chartBody}>
        <svg
          className={styles.chart}
          viewBox="0 0 280 150"
          role="img"
          aria-labelledby="revenue-chart-svg-title revenue-chart-svg-description"
        >
          <title id="revenue-chart-svg-title">
            Revenue estimate compared with reconciled truth
          </title>
          <desc id="revenue-chart-svg-description">
            April through July estimates increase. Reconciled final values are
            available through June; July is pending.
          </desc>
          <path
            className={styles.chartGrid}
            d="M22 28H258 M22 78H258 M22 128H258"
          />
          <path className={styles.estimatedLine} d={estimatedPath} />
          <path className={styles.finalLine} d={reconciledPath} />
          {points.map((point) => (
            <text
              key={point.period}
              x={point.x}
              y="146"
              textAnchor="middle"
              fontSize="10"
              fill="currentColor"
            >
              {point.period}
            </text>
          ))}
        </svg>
        <div className={styles.legend} aria-hidden="true">
          <span>Estimated</span>
          <span>Reconciled / final</span>
        </div>
        <details className={styles.dataAlternative} open>
          <summary>Semantic chart data</summary>
          <table className={styles.compactTable}>
            <caption className="sr-only">
              Revenue estimates and reconciled values by month
            </caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Estimated</th>
                <th scope="col">Reconciled</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {reportMetrics.map((metric) => (
                <tr key={metric.period}>
                  <th scope="row">{metric.period}</th>
                  <td>{formatMoney(metric.estimatedCents)}</td>
                  <td>
                    {metric.reconciledCents === null
                      ? "—"
                      : formatMoney(metric.reconciledCents)}
                  </td>
                  <td>
                    {metric.reconciledCents === null
                      ? "Pending reconciliation"
                      : "Final"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </section>
  );
}

export function ReportsView() {
  const [selectedReport, setSelectedReport] = useState("");
  const [accountId, setAccountId] = useState("");
  const [exporting, setExporting] = useState<ReportName | null>(null);
  const [message, setMessage] = useState<
    { tone: "status" | "alert"; text: string } | undefined
  >();
  const visibleReports = selectedReport
    ? reportCatalog.filter((report) => report.name === selectedReport)
    : reportCatalog;
  const selectedAccount = accountOptions.find(
    (account) => account.id === accountId,
  );

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
        text: `${report.replaceAll("_", " ")} export downloaded for ${selectedAccount?.label ?? "all available accounts"}.`,
      });
    } catch {
      setMessage({
        tone: "alert",
        text: "The export could not be generated. Report data on this page was not changed.",
      });
    } finally {
      setExporting(null);
    }
  }

  return (
    <FinancePageFrame
      title={lifecycleCopy.reports.title}
      description={lifecycleCopy.reports.description}
      freshness={lifecycleCopy.reports.freshness}
      source={lifecycleCopy.reports.source}
      permission="report:read"
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
            { value: "", label: "All supported reports" },
            ...reportCatalog.map((report) => ({
              value: report.name,
              label: report.label,
            })),
          ]}
          help="Only reports supported by the core report registry are listed."
        />
        <Select
          label="Account"
          name="accountId"
          value={accountId}
          onChange={(event) => setAccountId(event.currentTarget.value)}
          options={accountOptions.map((account) => ({
            value: account.id,
            label: account.label,
          }))}
          help="Human-readable selection; the report request submits the account ID."
        />
        <Button
          variant="secondary"
          size="small"
          onClick={() => {
            setSelectedReport("");
            setAccountId("");
          }}
        >
          Clear filters
        </Button>
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

      <div className={styles.reportLayout}>
        <section className={styles.panel} aria-labelledby="available-reports">
          <header className={styles.panelHeader}>
            <div>
              <h2 id="available-reports">Available report results</h2>
              <p>
                {visibleReports.length} result
                {visibleReports.length === 1 ? "" : "s"}
                {accountId ? ` for ${selectedAccount?.label}` : ""}
              </p>
            </div>
          </header>
          <div className={styles.reportList}>
            {visibleReports.length ? (
              visibleReports.map((report) => (
                <article className={styles.reportCard} key={report.name}>
                  <div>
                    <h3>{report.label}</h3>
                    <p>Source: {report.source}</p>
                    <p>{report.freshness}</p>
                    <div className={styles.reportMeta}>
                      <StatusBadge tone={stateTone(report.state)}>
                        {report.state}
                      </StatusBadge>
                      <StatusBadge
                        tone={report.state === "Final" ? "success" : "warning"}
                      >
                        Variance: {report.variance}
                      </StatusBadge>
                    </div>
                  </div>
                  <div className={styles.reportActions}>
                    <Button
                      variant="secondary"
                      size="small"
                      loading={exporting === report.name}
                      loadingLabel="Exporting…"
                      onClick={() => void exportReport(report.name)}
                    >
                      Export CSV
                    </Button>
                    <span className={styles.secondary}>Supported export</span>
                  </div>
                </article>
              ))
            ) : (
              <div className={styles.empty}>
                No reports match these filters.
              </div>
            )}
          </div>
        </section>
        <RevenueChart />
      </div>
    </FinancePageFrame>
  );
}
