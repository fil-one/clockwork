import type { ReportRow } from "./ports";

function safeCell(value: string): string {
  const protectedValue = /^(?:[=+\-@]|\s+[=+\-@])/.test(value)
    ? `'${value}`
    : value;
  return /[",\r\n]/.test(protectedValue)
    ? `"${protectedValue.replace(/"/g, '""')}"`
    : protectedValue;
}

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

  const lines = [
    columns.map(safeCell).join(","),
    ...rows.map((row) =>
      columns
        .map((column) => {
          const value = row[column];
          return safeCell(
            value === null || value === undefined ? "" : String(value),
          );
        })
        .join(","),
    ),
  ];
  return {
    bytes: new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`),
    columns,
  };
}
