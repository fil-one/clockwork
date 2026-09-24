import type { ProjectionRecord } from "@/src/features/experience-server/model";
import { formatOperationalTimestamp } from "@/src/features/internal-ops/presentation";

export type SearchGroup =
  | "Accounts"
  | "Agreements"
  | "Quotes"
  | "Orders"
  | "Invoices"
  | "End clients"
  | "Queues"
  | "Documents";

export interface SearchRecord {
  id: string;
  group: SearchGroup;
  title: string;
  subtitle: string;
  href: string;
  status: string;
}

export const SEARCH_GROUPS: readonly SearchGroup[] = [
  "Accounts",
  "Agreements",
  "Quotes",
  "Orders",
  "Invoices",
  "End clients",
  "Queues",
  "Documents",
];

/** Operator channels that resolve to a destination inside the internal shell. */
export const SEARCHABLE_CHANNELS = {
  dashboard: "Accounts",
  agreements: "Agreements",
  quotes: "Quotes",
  orders: "Orders",
  collections: "Invoices",
  queues: "Queues",
} as const satisfies Readonly<Record<string, SearchGroup>>;

export type SearchableChannel = keyof typeof SEARCHABLE_CHANNELS;

function text(
  data: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function contextLine(data: Readonly<Record<string, unknown>>): string | null {
  const entries = data.context;
  if (!Array.isArray(entries)) return null;
  const parts = entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Readonly<Record<string, unknown>>;
    const label = text(item, "label");
    const value = text(item, "value");
    return label && value ? [`${label} ${value}`] : [];
  });
  return parts.length ? parts.join(" · ") : null;
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
  if (group === "Accounts") return `/internal/accounts/${key}`;
  if (group === "Queues") return `/internal/queues/${key}`;
  if (group === "Agreements") return "/internal/agreements";
  if (group === "Invoices") return "/internal/collections";
  return accountRecordKey
    ? `/internal/accounts/${encodeURIComponent(accountRecordKey)}`
    : record.accountId
      ? `/internal/accounts/${encodeURIComponent(record.accountId)}`
      : "/internal/queues";
}

export function searchRecordFromProjection(
  record: ProjectionRecord,
  group: SearchGroup,
  /** The reader's formatting locale, for the update time. */
  locale: string,
  accountRecordKey?: string,
): SearchRecord {
  const data = record.data;
  return {
    id: record.recordKey,
    group,
    title: text(data, "title") ?? text(data, "name") ?? record.recordKey,
    subtitle:
      text(data, "description") ??
      contextLine(data) ??
      text(data, "nextAction") ??
      `Updated ${formatOperationalTimestamp(record.sourceUpdatedAt, locale)}`,
    href: destination(record, group, accountRecordKey),
    status: text(data, "statusLabel") ?? text(data, "status") ?? "Available",
  };
}

export function searchRecords(query: string, records: readonly SearchRecord[]) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return records.filter((record) => {
    const haystack =
      `${record.title} ${record.subtitle} ${record.id} ${record.group} ${record.status}`.toLocaleLowerCase();
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
