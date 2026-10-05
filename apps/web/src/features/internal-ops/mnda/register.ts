// i18n-exempt-file: CSV column names and codes stay stable for spreadsheet and CRM imports; file names are not reader text
import {
  mndaOpenStates,
  mndaSignerEmail,
  type MndaRecord,
} from "@clockwork/contracts";

const day = 86_400_000;

/** Whole days since the partner received an open request; null otherwise. */
export function mndaDaysOutstanding(
  record: Pick<MndaRecord, "state" | "sentAt">,
  now = Date.now(),
): number | null {
  if (!record.sentAt || !mndaOpenStates.includes(record.state)) return null;
  return Math.max(0, Math.floor((now - Date.parse(record.sentAt)) / day));
}

function fileWord(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "Counterparty"
  );
}
/** Same-origin PDF address: inline opens in a tab, `download` saves the file. */
export function mndaPdfHref(
  id: string,
  kind: "original" | "executed",
  download = false,
) {
  return `/internal/mndas/${id}/pdf?kind=${kind}${download ? "&download=1" : ""}`;
}
/** `Fil-One-MNDA_<Counterparty>_<YYYY-MM-DD>_<signed|draft>.pdf`: the
 * completion date for a signed agreement, the effective date for a draft. */
export function mndaPdfFilename(
  record: Pick<MndaRecord, "input" | "completedAt">,
  kind: "original" | "executed",
): string {
  const date =
    kind === "executed" && record.completedAt
      ? record.completedAt.slice(0, 10)
      : record.input.effectiveDate;
  return `Fil-One-MNDA_${fileWord(record.input.company)}_${date}_${kind === "executed" ? "signed" : "draft"}.pdf`;
}
export function contentDisposition(
  filename: string,
  disposition: "attachment" | "inline" = "attachment",
) {
  return `${disposition}; filename="${filename.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Spreadsheet apps execute cells that start with these characters. */
function cell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const columns = [
  "Company",
  "Partner signer",
  "Partner email",
  "Status",
  "Status code",
  "Fil One countersigner",
  "Prepared by",
  "Created",
  "Sent",
  "Days outstanding",
  "Completed",
  "Effective date",
  "Test mode",
  "Void reason",
  "Request ID",
] as const;

/** RFC 4180 CSV with a byte order mark so spreadsheet apps read UTF-8. */
export function mndaRegisterCsv(
  records: readonly MndaRecord[],
  labels: {
    status: (record: MndaRecord) => string;
    /** The void reason for a signer change, in the reader's language. */
    signerChange: string;
  },
  now = Date.now(),
): string {
  const rows = records.map((r) =>
    [
      r.input.company,
      r.input.signerName,
      mndaSignerEmail(r),
      labels.status(r),
      r.state,
      r.countersigner.name,
      r.ownerName,
      r.createdAt.slice(0, 10),
      r.sentAt?.slice(0, 10) ?? null,
      mndaDaysOutstanding(r, now),
      r.completedAt?.slice(0, 10) ?? null,
      r.input.effectiveDate,
      r.testMode ? "yes" : "no",
      r.cancelCode === "signer_change" ? labels.signerChange : r.cancelReason,
      r.id,
    ]
      .map(cell)
      .join(","),
  );
  return `\u{feff}${[columns.join(","), ...rows].join("\r\n")}\r\n`;
}
