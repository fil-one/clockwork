import type { ProjectionRecord } from "@/src/features/experience-server/model";

import {
  authoritative,
  recordEvidence,
  text,
  type EvidenceEntry,
} from "./projection-fields";

/**
 * One report export the operator's session is authorized to see.
 *
 * The internal `reports` channel is the `report_export` aggregate, whose
 * allowlisted payload is exactly three columns: `report`, `documentId` and
 * `status`. It carries no freshness, no variance and no reconciliation state,
 * so this row states none of them. The estimate-versus-reconciled chart the
 * retired fixture drew had no source at all.
 */
export interface ReportExportRecord {
  id: string;
  aggregateId: string;
  /** Registry name of the report, or `null` when the export names none. */
  report: string | null;
  title: string;
  status: string | null;
  /** The read boundary's label, used only when no status code is known. */
  statusLabel: string | null;
  /** Present once the export has produced a stored document. */
  documentId: string | null;
  evidence: readonly EvidenceEntry[];
  version: number;
  updatedAt: string;
}

export function reportExportFromProjection(
  record: ProjectionRecord,
): ReportExportRecord {
  const data = record.data;
  const state = authoritative(record);
  return {
    id: record.recordKey,
    aggregateId: record.aggregateId,
    report: text(state, "report"),
    title: text(data, "title") ?? record.recordKey,
    status: text(data, "status"),
    statusLabel: text(data, "statusLabel"),
    documentId: text(state, "documentId"),
    evidence: recordEvidence(record),
    version: record.version,
    updatedAt: record.sourceUpdatedAt,
  };
}

/**
 * An account an export may be scoped to: the projection's own reference and
 * relationship description, which the surface joins for the reader. The
 * account payload excludes names, so there is no legal name to show and none
 * is invented.
 */
export interface ReportAccountOption {
  id: string;
  reference: string;
  description: string | null;
}

/** Newest first, then by reference so equal timestamps still order stably. */
export function orderReportExports(
  records: readonly ReportExportRecord[],
): readonly ReportExportRecord[] {
  return [...records].sort(
    (left, right) =>
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
      left.id.localeCompare(right.id),
  );
}
