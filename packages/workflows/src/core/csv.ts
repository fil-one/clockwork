import { toCsv } from "@clockwork/domain/core";

import type { ReportRow } from "./ports";

/**
 * Column selection and validation for the report export. Cell neutralisation
 * and quoting belong to the single writer in the domain so this export and the
 * CSV download can never drift apart on what counts as a formula.
 */
export function renderCsv(
  rows: readonly ReportRow[],
  requestedColumns?: readonly string[],
): { bytes: Uint8Array; columns: readonly string[] } {
  const discovered = new Set(rows.flatMap((row) => Object.keys(row)));
  const columns = requestedColumns
    ? [...requestedColumns]
    : [...discovered].sort((left, right) => left.localeCompare(right));

  const duplicateColumns = columns.filter(
    (column, index) => columns.indexOf(column) !== index,
  );
  if (duplicateColumns.length > 0)
    throw new Error("Requested report columns must be unique");
  if (requestedColumns) {
    const missing = columns.filter((column) => !discovered.has(column));
    if (rows.length > 0 && missing.length > 0)
      throw new Error("Requested report column is not present in the result");
  }

  return {
    bytes: new TextEncoder().encode(toCsv(rows, columns)),
    columns,
  };
}
