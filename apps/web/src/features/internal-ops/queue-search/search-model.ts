import type { ProjectionRecord } from "@/src/features/experience-server/model";

export type SearchGroup =
  | "accounts"
  | "agreements"
  | "quotes"
  | "orders"
  | "invoices"
  | "endClients"
  | "queues"
  | "documents";

/**
 * The line under a result's title, as facts. The workspace words it in the
 * reader's language: the source's own description, its context lines, its
 * next action, or failing all of those, when it was last updated.
 */
export type SearchRecordDetail =
  | { kind: "text"; text: string }
  | {
      kind: "context";
      entries: ReadonlyArray<{ label: string; value: string }>;
    }
  | { kind: "updated"; at: string };

export interface SearchRecord {
  id: string;
  group: SearchGroup;
  title: string;
  detail: SearchRecordDetail;
  href: string;
  /** Status wording the source wrote, when it wrote any. */
  statusLabel: string | null;
  /** The source's machine status, for a record with no status wording. */
  status: string | null;
}

export const SEARCH_GROUPS: readonly SearchGroup[] = [
  "accounts",
  "agreements",
  "quotes",
  "orders",
  "invoices",
  "endClients",
  "queues",
  "documents",
];

/** Operator channels that resolve to a destination inside the internal shell. */
export const SEARCHABLE_CHANNELS = {
  dashboard: "accounts",
  agreements: "agreements",
  quotes: "quotes",
  orders: "orders",
  collections: "invoices",
  queues: "queues",
} as const satisfies Readonly<Record<string, SearchGroup>>;

export type SearchableChannel = keyof typeof SEARCHABLE_CHANNELS;

function text(
  data: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function contextEntries(
  data: Readonly<Record<string, unknown>>,
): ReadonlyArray<{ label: string; value: string }> {
  const entries = data.context;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Readonly<Record<string, unknown>>;
    const label = text(item, "label");
    const value = text(item, "value");
    return label && value ? [{ label, value }] : [];
  });
}

/**
 * Every destination stays inside the internal shell. A record whose type has no
 * dedicated operator surface resolves to the account that owns it, which is the
 * only other place an operator can act on it.
 */
function destination(
  record: ProjectionRecord,
  group: SearchGroup,
  accountRecordKey?: string,
): string {
  const key = encodeURIComponent(record.recordKey);
  if (group === "accounts") return `/internal/accounts/${key}`;
  if (group === "queues") return `/internal/queues/${key}`;
  if (group === "agreements") return "/internal/agreements";
  if (group === "invoices") return "/internal/collections";
  return accountRecordKey
    ? `/internal/accounts/${encodeURIComponent(accountRecordKey)}`
    : record.accountId
      ? `/internal/accounts/${encodeURIComponent(record.accountId)}`
      : "/internal/queues";
}

function detail(record: ProjectionRecord): SearchRecordDetail {
  const data = record.data;
  const description = text(data, "description");
  if (description) return { kind: "text", text: description };
  const entries = contextEntries(data);
  if (entries.length) return { kind: "context", entries };
  const nextAction = text(data, "nextAction");
  if (nextAction) return { kind: "text", text: nextAction };
  return { kind: "updated", at: record.sourceUpdatedAt };
}

export function searchRecordFromProjection(
  record: ProjectionRecord,
  group: SearchGroup,
  accountRecordKey?: string,
): SearchRecord {
  const data = record.data;
  return {
    id: record.recordKey,
    group,
    title: text(data, "title") ?? text(data, "name") ?? record.recordKey,
    detail: detail(record),
    href: destination(record, group, accountRecordKey),
    statusLabel: text(data, "statusLabel"),
    status: text(data, "status"),
  };
}

function detailText(detail: SearchRecordDetail): string {
  if (detail.kind === "text") return detail.text;
  if (detail.kind === "context")
    return detail.entries
      .flatMap(({ label, value }) => [label, value])
      .join(" ");
  return "";
}

/**
 * Matches every term against what the result shows and its identifiers.
 *
 * `shownWords` supplies the words the page adds in the reader's language -- the
 * group name, a status the source did not word -- so "invoices" finds invoices
 * in English and "faturas" finds them in Portuguese.
 */
export function searchRecords(
  query: string,
  records: readonly SearchRecord[],
  shownWords: (record: SearchRecord) => string,
) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return records.filter((record) => {
    const haystack = [
      record.title,
      detailText(record.detail),
      record.id,
      record.statusLabel ?? "",
      record.status ?? "",
      shownWords(record),
    ]
      .join(" ")
      .toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function groupSearchResults(results: readonly SearchRecord[]) {
  return SEARCH_GROUPS.map((group) => ({
    group,
    results: results.filter((record) => record.group === group),
  })).filter((entry) => entry.results.length > 0);
}

export function nextSearchIndex(
  current: number,
  key: "ArrowDown" | "ArrowUp",
  count: number,
) {
  if (count === 0) return -1;
  if (key === "ArrowDown") return current >= count - 1 ? 0 : current + 1;
  return current <= 0 ? count - 1 : current - 1;
}
