import { describe, expect, it } from "vitest";

import { projectionRecord } from "./projection-test-support";
import {
  orderReportExports,
  reportExportFromProjection,
} from "./reports-projection";

function reportExport(input: {
  id: string;
  report?: string;
  status?: string;
  documentId?: string;
  updatedAt?: string;
}) {
  return projectionRecord({
    recordKey: `report_export-${input.id}`,
    aggregateType: "report_export",
    aggregateId: input.id,
    channel: "reports",
    sourceUpdatedAt: input.updatedAt ?? "2026-08-01T00:00:00.000Z",
    authoritative: {
      status: input.status ?? "pending",
      ...(input.report ? { report: input.report } : {}),
      ...(input.documentId ? { documentId: input.documentId } : {}),
    },
    data: {
      title: input.report ? "Revenue Forecast" : `RPT-${input.id.slice(0, 8)}`,
      status: input.status ?? "pending",
      statusLabel: "Pending",
    },
  });
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("reportExportFromProjection", () => {
  it("reads the three columns the report_export payload actually has", () => {
    const record = reportExportFromProjection(
      reportExport({
        id: A,
        report: "revenue_forecast",
        status: "complete",
        documentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      }),
    );

    expect(record).toMatchObject({
      report: "revenue_forecast",
      status: "complete",
      documentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });
  });

  /**
   * The retired fixture gave every report a freshness, a variance and a
   * reconciliation state. None of the three is in the payload, so the mapped
   * record has no field for any of them.
   */
  it("carries no freshness, variance or reconciliation state", () => {
    const record = reportExportFromProjection(reportExport({ id: A }));

    expect(Object.keys(record).sort()).toEqual([
      "aggregateId",
      "documentId",
      "evidence",
      "id",
      "report",
      "status",
      "statusLabel",
      "title",
      "updatedAt",
      "version",
    ]);
  });

  it("reports no document until one is stored", () => {
    expect(
      reportExportFromProjection(reportExport({ id: A })).documentId,
    ).toBeNull();
  });
});

describe("orderReportExports", () => {
  it("puts the newest export first", () => {
    const ordered = orderReportExports(
      [
        reportExport({ id: A, updatedAt: "2026-08-01T00:00:00.000Z" }),
        reportExport({ id: B, updatedAt: "2026-08-09T00:00:00.000Z" }),
      ].map(reportExportFromProjection),
    );

    expect(ordered.map((record) => record.aggregateId)).toEqual([B, A]);
  });
});
