import type { MessageId } from "@/src/i18n";

export type QueueRisk = "low" | "medium" | "high";
export type QueueStatus = "open" | "pending" | "blocked" | "resolved";
export type QueueSla = "breached" | "due-soon" | "healthy";
export type QueueView =
  "assigned-to-me" | "sla-breached" | "high-risk" | "awaiting-backup" | "all";

export const DEFAULT_QUEUE_SORT = "sla-risk-age" as const;

/**
 * The saved views, in tab order. `label` names the tab; `description` is its
 * tooltip.
 */
export const SAVED_VIEWS: ReadonlyArray<{
  id: QueueView;
  label: MessageId;
  description: MessageId;
}> = [
  {
    id: "assigned-to-me",
    label: "operations.queue.view.assigned",
    description: "operations.queue.view.assigned.description",
  },
  {
    id: "sla-breached",
    label: "operations.queue.view.slaBreached",
    description: "operations.queue.view.slaBreached.description",
  },
  {
    id: "high-risk",
    label: "risk.chip.high",
    description: "operations.queue.view.highRisk.description",
  },
  {
    id: "awaiting-backup",
    label: "operations.queue.view.awaitingBackup",
    description: "operations.queue.view.awaitingBackup.description",
  },
  {
    id: "all",
    label: "common.all",
    description: "operations.queue.view.all.description",
  },
];

export interface QueuePerson {
  id: string;
  label: string;
}

/**
 * Fields the operational projection cannot supply are `null` rather than a
 * filled-in default: a queue record carries no assignment, policy citation or
 * created date until the source aggregate publishes one. Filters that read a
 * null field match nothing, so no row is presented as more complete than it is.
 */
export interface QueueItem {
  id: string;
  title: string;
  /** The record the case is about, as the source's object-type code. */
  entity: string | null;
  /** The exception queue, as the source's queue code. */
  type: string | null;
  owner: string | null;
  ownerId: string | null;
  backup: string | null;
  backupId: string | null;
  risk: QueueRisk | null;
  status: QueueStatus | null;
  /** Source-supplied status wording; falls back to the machine status. */
  statusLabel?: string;
  createdAt: string | null;
  updatedAt: string;
  dueAt: string | null;
  ageDays: number | null;
  summary: string | null;
  policyReason: string | null;
  policyBasis: string | null;
  /** Context lines the source wrote, label and value as supplied. */
  evidence: ReadonlyArray<{
    label: string;
    value: string;
    technicalId?: string;
  }>;
  /**
   * The projection row the item was read from. Kept as facts so the detail
   * panel states the version and update time in the reader's language.
   */
  sourceRecord: {
    version: number;
    updatedAt: string;
    technicalId: string;
  } | null;
  related: ReadonlyArray<{ label: string; href: string }>;
  /** Action codes the source allows (`review_exception`, ...). */
  permittedActions: readonly string[];
  requiredRole?:
    "legal_approver" | "finance_approver" | "destructive_action_approver";
}

export interface QueueFilters {
  text: string;
  type: string;
  backup: string;
  sla: string;
  age: string;
  status: string;
  risk: string;
  owner: string;
  sort: string;
  view: QueueView;
  page: number;
  pageSize: number;
}

export const DEFAULT_FILTERS: QueueFilters = {
  text: "",
  type: "all",
  backup: "all",
  sla: "all",
  age: "all",
  status: "all",
  risk: "all",
  owner: "all",
  sort: DEFAULT_QUEUE_SORT,
  view: "all",
  page: 1,
  pageSize: 10,
};

export interface QueueScope {
  /** Identifier of the signed-in operator, used by the assigned-to-me view. */
  actorId?: string | null;
  now?: Date;
}

const VIEWS = new Set(SAVED_VIEWS.map((view) => view.id));
const STRUCTURED_FILTER = /(?:^|\s)(type|backup|sla|age):("[^"]*"|\S+)/gi;

export function decodeQueueQuery(value: string | null | undefined) {
  const filters: Pick<
    QueueFilters,
    "text" | "type" | "backup" | "sla" | "age"
  > = {
    text: "",
    type: "all",
    backup: "all",
    sla: "all",
    age: "all",
  };
  const text = (value ?? "").replace(
    STRUCTURED_FILTER,
    (_match, key: "type" | "backup" | "sla" | "age", raw: string) => {
      filters[key] = raw.replace(/^"|"$/g, "");
      return " ";
    },
  );
  filters.text = text.replace(/\s+/g, " ").trim();
  return filters;
}

export function encodeQueueQuery(
  filters: Pick<QueueFilters, "text" | "type" | "backup" | "sla" | "age">,
) {
  const parts = [filters.text.trim()];
  for (const key of ["type", "backup", "sla", "age"] as const) {
    const value = filters[key];
    if (value && value !== "all") {
      const encoded = value.includes(" ") ? `"${value}"` : value;
      parts.push(`${key}:${encoded}`);
    }
  }
  return parts.filter(Boolean).join(" ");
}

export function parseQueueFilters(searchParams: URLSearchParams): QueueFilters {
  const structured = decodeQueueQuery(searchParams.get("q"));
  const rawView = searchParams.get("view") ?? "all";
  const rawPage = Number(searchParams.get("page") ?? 1);
  const rawPageSize = Number(searchParams.get("pageSize") ?? 10);
  return {
    ...DEFAULT_FILTERS,
    ...structured,
    status: searchParams.get("status") ?? "all",
    risk: searchParams.get("risk") ?? "all",
    owner: searchParams.get("owner") ?? "all",
    sort: searchParams.get("sort") ?? DEFAULT_QUEUE_SORT,
    view: VIEWS.has(rawView as QueueView) ? (rawView as QueueView) : "all",
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    pageSize: [10, 25, 50].includes(rawPageSize) ? rawPageSize : 10,
  };
}

export function serializeQueueFilters(filters: QueueFilters): URLSearchParams {
  const params = new URLSearchParams();
  const q = encodeQueueQuery(filters);
  if (q) params.set("q", q);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.risk !== "all") params.set("risk", filters.risk);
  if (filters.owner !== "all") params.set("owner", filters.owner);
  params.set("sort", filters.sort || DEFAULT_QUEUE_SORT);
  params.set("view", filters.view);
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  return params;
}

/** Null when the record carries no policy deadline to measure against. */
export function slaFor(item: QueueItem, now = new Date()): QueueSla | null {
  if (!item.dueAt) return null;
  const deadline = Date.parse(item.dueAt);
  if (!Number.isFinite(deadline)) return null;
  const remaining = deadline - now.getTime();
  if (remaining < 0) return "breached";
  if (remaining <= 24 * 60 * 60 * 1000) return "due-soon";
  return "healthy";
}

export function matchesSavedView(
  item: QueueItem,
  view: QueueView,
  scope: QueueScope = {},
): boolean {
  if (view === "assigned-to-me")
    return Boolean(
      scope.actorId &&
      item.ownerId === scope.actorId &&
      item.status !== "resolved",
    );
  if (view === "sla-breached")
    return slaFor(item, scope.now) === "breached" && item.status !== "resolved";
  if (view === "high-risk")
    return item.risk === "high" && item.status !== "resolved";
  if (view === "awaiting-backup")
    return item.backup === null && item.status !== "resolved";
  return true;
}

function matchesAge(item: QueueItem, age: string) {
  if (age === "all") return true;
  if (item.ageDays === null) return false;
  if (age === "7") return item.ageDays <= 7;
  if (age === "8-30") return item.ageDays >= 8 && item.ageDays <= 30;
  if (age === "30+") return item.ageDays > 30;
  return true;
}

export function filterQueueItems(
  items: readonly QueueItem[],
  filters: QueueFilters,
  scope: QueueScope = {},
) {
  const term = filters.text.toLocaleLowerCase();
  return items.filter((item) => {
    const text =
      `${item.title} ${item.entity ?? ""} ${item.id} ${item.summary ?? ""}`.toLocaleLowerCase();
    return (
      matchesSavedView(item, filters.view, scope) &&
      (!term || text.includes(term)) &&
      (filters.type === "all" ||
        item.type?.toLocaleLowerCase() === filters.type) &&
      (filters.backup === "all" ||
        (filters.backup === "unassigned"
          ? item.backup === null
          : item.backupId === filters.backup)) &&
      (filters.sla === "all" || slaFor(item, scope.now) === filters.sla) &&
      matchesAge(item, filters.age) &&
      (filters.status === "all" || item.status === filters.status) &&
      (filters.risk === "all" || item.risk === filters.risk) &&
      (filters.owner === "all" || item.ownerId === filters.owner)
    );
  });
}

const RISK_ORDER: Record<QueueRisk, number> = { high: 0, medium: 1, low: 2 };
const SLA_ORDER: Record<QueueSla, number> = {
  breached: 0,
  "due-soon": 1,
  healthy: 2,
};

/** Records without a deadline or age sort after the ones that have them. */
function slaRank(item: QueueItem, now?: Date) {
  const sla = slaFor(item, now);
  return sla === null ? SLA_ORDER.healthy + 1 : SLA_ORDER[sla];
}

function ageRank(item: QueueItem) {
  return item.ageDays ?? -1;
}

function riskRank(item: QueueItem) {
  return item.risk === null ? RISK_ORDER.low + 1 : RISK_ORDER[item.risk];
}

export function sortQueueItems(
  items: readonly QueueItem[],
  sort: string = DEFAULT_QUEUE_SORT,
  now?: Date,
) {
  return [...items].sort((left, right) => {
    if (sort === "oldest") return ageRank(right) - ageRank(left);
    if (sort === "risk")
      return riskRank(left) - riskRank(right) || ageRank(right) - ageRank(left);
    if (sort === "updated")
      return (
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      );
    return (
      slaRank(left, now) - slaRank(right, now) ||
      riskRank(left) - riskRank(right) ||
      ageRank(right) - ageRank(left)
    );
  });
}

export interface QueuePage {
  items: readonly QueueItem[];
  page: number;
  pageCount: number;
}

/**
 * Clamps the requested page into the result set. A saved link that outlived the
 * work it pointed at lands on the last page rather than on a blank one.
 */
export function paginateQueueItems(
  items: readonly QueueItem[],
  page: number,
  pageSize: number,
): QueuePage {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  return {
    items: items.slice((current - 1) * pageSize, current * pageSize),
    page: current,
    pageCount,
  };
}

export type ActiveFilterKey =
  | "view"
  | "text"
  | "type"
  | "owner"
  | "backup"
  | "sla"
  | "risk"
  | "status"
  | "age";

/**
 * The filters narrowing the list, in the order the summary names them. Values
 * are the filter's own codes (a person id, `high`, `8-30`); the workspace
 * turns each into words in the reader's language.
 */
export function activeFilters(
  filters: QueueFilters,
): ReadonlyArray<{ filter: ActiveFilterKey; value: string }> {
  const active: { filter: ActiveFilterKey; value: string }[] = [];
  if (filters.view !== "all" && VIEWS.has(filters.view))
    active.push({ filter: "view", value: filters.view });
  if (filters.text) active.push({ filter: "text", value: filters.text });
  if (filters.type !== "all")
    active.push({ filter: "type", value: filters.type });
  if (filters.owner !== "all")
    active.push({ filter: "owner", value: filters.owner });
  if (filters.backup !== "all")
    active.push({ filter: "backup", value: filters.backup });
  if (filters.sla !== "all") active.push({ filter: "sla", value: filters.sla });
  if (filters.risk !== "all")
    active.push({ filter: "risk", value: filters.risk });
  if (filters.status !== "all")
    active.push({ filter: "status", value: filters.status });
  if (filters.age !== "all") active.push({ filter: "age", value: filters.age });
  return active;
}

/** A person's name from the loaded records, or `null` for the unassigned bucket. */
export function ownerLabel(
  id: string,
  people: readonly QueuePerson[],
): string | null {
  if (id === "unassigned") return null;
  return people.find((person) => person.id === id)?.label ?? id;
}

/** Selectable owners and types come from the loaded records, never a roster. */
export function queueOwnerOptions(
  items: readonly QueueItem[],
): readonly QueuePerson[] {
  const people = new Map<string, string>();
  for (const item of items) {
    if (item.ownerId && item.owner) people.set(item.ownerId, item.owner);
    if (item.backupId && item.backup) people.set(item.backupId, item.backup);
  }
  return [...people]
    .map(([id, label]) => ({ id, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

/** Queue codes present in the loaded records, for the type filter. */
export function queueTypeOptions(
  items: readonly QueueItem[],
): readonly string[] {
  const types = items
    .map((item) => item.type?.toLocaleLowerCase())
    .filter((type): type is string => Boolean(type));
  return [...new Set(types)].sort((left, right) => left.localeCompare(right));
}

export const operationalRoleNames = [
  "internal_operator",
  "finance_approver",
  "legal_approver",
  "destructive_action_approver",
] as const;

export type OperationalRole = (typeof operationalRoleNames)[number];

/** Narrows a session's roles without widening what the workspace will honor. */
export function operationalRoles(
  roles: readonly string[],
): readonly OperationalRole[] {
  return roles.filter((role): role is OperationalRole =>
    (operationalRoleNames as readonly string[]).includes(role),
  );
}

/**
 * Hides the decision actions a role cannot take. Matches action codes
 * (`approve_exception`) as well as the worded forms older sources wrote.
 */
export function permittedActions(
  item: QueueItem,
  roles: readonly OperationalRole[],
) {
  if (!item.requiredRole || roles.includes(item.requiredRole))
    return item.permittedActions;
  return item.permittedActions.filter(
    (action) =>
      !/approve|recommendation|legal[ _]review|finance[ _]review/i.test(action),
  );
}

export function selectQueueItem(
  items: readonly QueueItem[],
  requestedId: string | null,
) {
  return items.find((item) => item.id === requestedId) ?? items[0] ?? null;
}
