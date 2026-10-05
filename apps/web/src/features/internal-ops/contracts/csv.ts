/**
 * RFC 4180 CSV. A cell a spreadsheet would read as a formula (=, +, -, @,
 * tab or carriage return first) is prefixed with an apostrophe, so a
 * counterparty name cannot run as a formula on the reader's machine.
 */
export function csvCell(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const byteOrderMark = String.fromCharCode(0xfeff);

export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | boolean | null | undefined)[])[],
) {
  // A byte-order mark lets spreadsheet software read accented names as UTF-8.
  return `${byteOrderMark}${[header, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")}\r\n`;
}
