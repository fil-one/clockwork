export type QueueRisk = "low" | "medium" | "high";
export type QueueStatus = "open" | "pending" | "blocked" | "resolved";
export type QueueSla = "breached" | "due-soon" | "healthy";
export type QueueView =
  "assigned-to-me" | "sla-breached" | "high-risk" | "awaiting-backup" | "all";

export const DEFAULT_QUEUE_SORT = "sla-risk-age" as const;

export const SAVED_VIEWS: ReadonlyArray<{
  id: QueueView;
  label: string;
  description: string;
}> = [
  {
    id: "assigned-to-me",
    label: "Assigned to me",
    description: "Open work owned by James Kurz",
  },
  {
    id: "sla-breached",
    label: "SLA breached",
    description: "Items already outside their response policy",
  },
  {
    id: "high-risk",
    label: "High risk",
    description: "Open items with high business or compliance risk",
  },
  {
    id: "awaiting-backup",
    label: "Awaiting backup",
    description: "Items that still need a backup owner",
  },
  { id: "all", label: "All", description: "All queue work" },
];

export interface QueueItem {
  id: string;
  title: string;
  entity: string;
  type:
    | "Pricing"
    | "Legal"
    | "Collections"
    | "Screening"
    | "Migration"
    | "Provisioning";
  owner: string;
  ownerId: string;
  backup: string | null;
  backupId: string | null;
  risk: QueueRisk;
  status: QueueStatus;
  createdAt: string;
  updatedAt: string;
  dueAt: string;
  ageDays: number;
  summary: string;
  policyReason: string;
  policyBasis: string;
  evidence: ReadonlyArray<{
    label: string;
    value: string;
    technicalId?: string;
  }>;
  related: ReadonlyArray<{ label: string; href: string }>;
  permittedActions: readonly string[];
  requiredRole?:
    "legal_approver" | "finance_approver" | "destructive_action_approver";
}

export const QUEUE_ITEMS: readonly QueueItem[] = [
  {
    id: "EXC-COL-008",
    title: "Collections aging decision",
    entity: "Northstar Archive Labs",
    type: "Collections",
    owner: "Amina Cole",
    ownerId: "usr_amina_cole",
    backup: "James Kurz",
    backupId: "usr_james_kurz",
    risk: "high",
    status: "blocked",
    createdAt: "2026-07-02T14:22:00Z",
    updatedAt: "2026-07-31T15:42:00Z",
    dueAt: "2026-07-30T17:00:00Z",
    ageDays: 29,
    summary:
      "$22,800 is 46 days overdue; service suspension remains policy-gated.",
    policyReason:
      "Collections action crossed the 45-day threshold while a retention hold remains active.",
    policyBasis: "FIN-COL-04 · collections suspension and retention exception",
    evidence: [
      { label: "Overdue balance", value: "$22,800 final invoice truth" },
      {
        label: "Retention hold",
        value: "Locked through Apr 15, 2027",
        technicalId: "RET-2027-0415",
      },
      { label: "Last customer contact", value: "Jul 29, 2026 at 2:14 PM EDT" },
    ],
    related: [
      { label: "Invoice INV-2026-0781", href: "/internal/collections" },
      { label: "Northstar account", href: "/internal/accounts/acct_northstar" },
    ],
    permittedActions: [
      "Request finance review",
      "Add evidence",
      "Reassign owner",
    ],
    requiredRole: "finance_approver",
  },
  {
    id: "EXC-SCR-004",
    title: "Restricted-party possible match",
    entity: "Atlas Field Imaging",
    type: "Screening",
    owner: "James Kurz",
    ownerId: "usr_james_kurz",
    backup: null,
    backupId: null,
    risk: "high",
    status: "blocked",
    createdAt: "2026-07-18T13:05:00Z",
    updatedAt: "2026-07-31T15:18:00Z",
    dueAt: "2026-07-31T14:00:00Z",
    ageDays: 13,
    summary:
      "A provider screening match blocks the transaction until legal records a disposition.",
    policyReason:
      "Potential restricted-party match exceeds the automatic-clear confidence boundary.",
    policyBasis: "LGL-SCR-02 · manual match resolution with actor attribution",
    evidence: [
      { label: "Provider confidence", value: "0.81 possible match" },
      { label: "Matched jurisdiction", value: "United States" },
      {
        label: "Screening request",
        value: "Provider response retained",
        technicalId: "scr_01J4Q9NZX8M3",
      },
    ],
    related: [
      { label: "Atlas end client", href: "/internal/search?q=Atlas" },
      { label: "Migration APR-MIG-016", href: "/internal/queues/APR-MIG-016" },
    ],
    permittedActions: [
      "Request legal review",
      "Attach screening evidence",
      "Assign backup",
    ],
    requiredRole: "legal_approver",
  },
  {
    id: "EXC-PRC-019",
    title: "Pricing exception for Halcyon expansion",
    entity: "Halcyon Research Cooperative",
    type: "Pricing",
    owner: "James Kurz",
    ownerId: "usr_james_kurz",
    backup: "Amina Cole",
    backupId: "usr_amina_cole",
    risk: "medium",
    status: "open",
    createdAt: "2026-07-21T11:30:00Z",
    updatedAt: "2026-07-31T15:35:00Z",
    dueAt: "2026-07-31T17:00:00Z",
    ageDays: 10,
    summary: "Requested annual price is 1.7% below the current floor.",
    policyReason:
      "Discount is outside the operator band and requires attributed approval.",
    policyBasis: "COM-PRC-07 · floor variance approval",
    evidence: [
      { label: "Requested annual value", value: "$91,200 estimate" },
      { label: "Floor variance", value: "−1.7%" },
      {
        label: "Price book version",
        value: "USD 2026.3",
        technicalId: "pb_usd_2026_3",
      },
    ],
    related: [
      { label: "Quote Q-2026-0184-v3", href: "/quotes/Q-2026-0184-v3" },
      { label: "Halcyon end client", href: "/internal/search?q=Halcyon" },
    ],
    permittedActions: [
      "Submit approval recommendation",
      "Return for revision",
      "Reassign owner",
    ],
    requiredRole: "finance_approver",
  },
  {
    id: "EXC-LGL-011",
    title: "Customer paper variance review",
    entity: "Northstar Archive Labs",
    type: "Legal",
    owner: "Juno Okafor",
    ownerId: "usr_juno_okafor",
    backup: "Triage rotation",
    backupId: "team_legal_triage",
    risk: "medium",
    status: "pending",
    createdAt: "2026-07-23T09:12:00Z",
    updatedAt: "2026-07-31T13:04:00Z",
    dueAt: "2026-08-02T17:00:00Z",
    ageDays: 8,
    summary:
      "Four terms differ materially from the approved service agreement template.",
    policyReason:
      "Liability, governing law, audit, and termination terms require counsel review.",
    policyBasis: "LGL-AGR-03 · material customer-paper variance",
    evidence: [
      { label: "Material variances", value: "4 clauses" },
      { label: "Compared template", value: "Cloud Service Agreement v3.2" },
      {
        label: "Comparison run",
        value: "Jul 31 at 9:04 AM EDT",
        technicalId: "cmp_01J4QAB0D",
      },
    ],
    related: [
      { label: "Agreement AGR-2026-0061", href: "/internal/agreements" },
    ],
    permittedActions: [
      "Record legal recommendation",
      "Request counterparty clarification",
      "Add evidence",
    ],
    requiredRole: "legal_approver",
  },
  {
    id: "EXC-PRO-014",
    title: "Provisioning recovery approval",
    entity: "Madrid compliance replica",
    type: "Provisioning",
    owner: "Amina Cole",
    ownerId: "usr_amina_cole",
    backup: null,
    backupId: null,
    risk: "high",
    status: "open",
    createdAt: "2026-07-24T16:18:00Z",
    updatedAt: "2026-07-31T15:51:00Z",
    dueAt: "2026-07-31T18:00:00Z",
    ageDays: 7,
    summary:
      "A retry-safe capacity step has failed three times with a transient provider response.",
    policyReason:
      "Automated retry limit reached; a person must verify provider state before replay.",
    policyBasis: "OPS-PRO-05 · idempotent recovery after retry exhaustion",
    evidence: [
      { label: "Attempts", value: "3 of 3 automatic attempts" },
      { label: "Failure class", value: "Transient provider timeout" },
      {
        label: "Idempotency key",
        value: "Available and unchanged",
        technicalId: "idem_ord_0112_capacity",
      },
    ],
    related: [{ label: "Order ORD-2026-0112", href: "/internal/provisioning" }],
    permittedActions: [
      "Verify provider state",
      "Approve safe retry",
      "Assign backup",
    ],
  },
  {
    id: "APR-MIG-016",
    title: "Resolve ambiguous account match",
    entity: "Northstar Archive Services",
    type: "Migration",
    owner: "James Kurz",
    ownerId: "usr_james_kurz",
    backup: "Amina Cole",
    backupId: "usr_amina_cole",
    risk: "medium",
    status: "pending",
    createdAt: "2026-07-08T10:42:00Z",
    updatedAt: "2026-07-31T12:22:00Z",
    dueAt: "2026-08-04T17:00:00Z",
    ageDays: 23,
    summary:
      "Three account candidates share identifiers; new-account creation is disabled.",
    policyReason:
      "The legal entity and domain do not produce one unambiguous existing-account match.",
    policyBasis: "OPS-MIG-01 · no account creation on ambiguous identity",
    evidence: [
      { label: "Candidate matches", value: "3 existing records" },
      { label: "Creation safety", value: "New account creation blocked" },
      {
        label: "Source row",
        value: "Legacy row retained",
        technicalId: "legacy_account_00981",
      },
    ],
    related: [
      { label: "Migration candidate report", href: "/internal/migrations" },
    ],
    permittedActions: [
      "Choose existing account",
      "Mark for data correction",
      "Add evidence",
    ],
  },
  {
    id: "EXC-DSP-012",
    title: "Invoice service-period dispute",
    entity: "Halcyon Research Cooperative",
    type: "Collections",
    owner: "James Kurz",
    ownerId: "usr_james_kurz",
    backup: "Amina Cole",
    backupId: "usr_amina_cole",
    risk: "medium",
    status: "open",
    createdAt: "2026-07-16T12:10:00Z",
    updatedAt: "2026-07-30T17:11:00Z",
    dueAt: "2026-08-03T17:00:00Z",
    ageDays: 15,
    summary:
      "$8,460 remains disputed while service-period evidence is collected.",
    policyReason: "A recorded dispute pauses automated collections escalation.",
    policyBasis: "FIN-DSP-02 · disputed balance hold",
    evidence: [
      { label: "Disputed value", value: "$8,460 final invoice truth" },
      { label: "Evidence deadline", value: "Aug 3, 2026 at 5:00 PM EDT" },
    ],
    related: [{ label: "Collections record", href: "/internal/collections" }],
    permittedActions: [
      "Add service evidence",
      "Request finance review",
      "Reassign owner",
    ],
    requiredRole: "finance_approver",
  },
  {
    id: "APR-DEL-003",
    title: "Retention-exclusion deletion approval",
    entity: "Legacy analytics archive",
    type: "Legal",
    owner: "Juno Okafor",
    ownerId: "usr_juno_okafor",
    backup: null,
    backupId: null,
    risk: "high",
    status: "blocked",
    createdAt: "2026-07-11T08:45:00Z",
    updatedAt: "2026-07-31T14:48:00Z",
    dueAt: "2026-08-01T16:00:00Z",
    ageDays: 20,
    summary:
      "A destructive action excludes four locked objects and needs two distinct approvers.",
    policyReason:
      "Deletion cannot include retained objects or use the requesting actor as final approver.",
    policyBasis: "SEC-DEL-09 · dual control and retention preservation",
    evidence: [
      { label: "Affected objects", value: "8,214 eligible; 4 excluded" },
      { label: "Dual control", value: "Second distinct approver required" },
      {
        label: "Retention set",
        value: "Immutable evidence retained",
        technicalId: "retset_7f3c9",
      },
    ],
    related: [
      {
        label: "Offboarding record",
        href: "/internal/search?q=Legacy%20analytics",
      },
    ],
    permittedActions: ["Add evidence", "Assign backup", "Open approval review"],
    requiredRole: "destructive_action_approver",
  },
  {
    id: "EXC-POC-021",
    title: "POC qualification review",
    entity: "Atlas Field Imaging",
    type: "Provisioning",
    owner: "James Kurz",
    ownerId: "usr_james_kurz",
    backup: "Amina Cole",
    backupId: "usr_amina_cole",
    risk: "low",
    status: "resolved",
    createdAt: "2026-07-28T10:00:00Z",
    updatedAt: "2026-07-31T15:59:00Z",
    dueAt: "2026-08-02T16:00:00Z",
    ageDays: 3,
    summary:
      "Qualification evidence is complete and the record is ready to close.",
    policyReason: "All four technical success criteria were recorded.",
    policyBasis: "COM-POC-01 · evidence-based qualification",
    evidence: [{ label: "Success tests", value: "4 of 4 passed" }],
    related: [
      { label: "Atlas search results", href: "/internal/search?q=Atlas" },
    ],
    permittedActions: ["Close item", "Add evidence"],
  },
] as const;

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

export function slaFor(
  item: QueueItem,
  now = new Date("2026-07-31T16:00:00Z"),
): QueueSla {
  const remaining = new Date(item.dueAt).getTime() - now.getTime();
  if (remaining < 0) return "breached";
  if (remaining <= 24 * 60 * 60 * 1000) return "due-soon";
  return "healthy";
}

export function matchesSavedView(item: QueueItem, view: QueueView): boolean {
  if (view === "assigned-to-me")
    return item.ownerId === "usr_james_kurz" && item.status !== "resolved";
  if (view === "sla-breached")
    return slaFor(item) === "breached" && item.status !== "resolved";
  if (view === "high-risk")
    return item.risk === "high" && item.status !== "resolved";
  if (view === "awaiting-backup")
    return item.backup === null && item.status !== "resolved";
  return true;
}

function matchesAge(item: QueueItem, age: string) {
  if (age === "7") return item.ageDays <= 7;
  if (age === "8-30") return item.ageDays >= 8 && item.ageDays <= 30;
  if (age === "30+") return item.ageDays > 30;
  return true;
}

export function filterQueueItems(
  items: readonly QueueItem[],
  filters: QueueFilters,
) {
  const term = filters.text.toLocaleLowerCase();
  return items.filter((item) => {
    const text =
      `${item.title} ${item.entity} ${item.id} ${item.summary}`.toLocaleLowerCase();
    return (
      matchesSavedView(item, filters.view) &&
      (!term || text.includes(term)) &&
      (filters.type === "all" ||
        item.type.toLocaleLowerCase() === filters.type) &&
      (filters.backup === "all" ||
        (filters.backup === "unassigned"
          ? item.backup === null
          : item.backupId === filters.backup)) &&
      (filters.sla === "all" || slaFor(item) === filters.sla) &&
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

export function sortQueueItems(
  items: readonly QueueItem[],
  sort: string = DEFAULT_QUEUE_SORT,
) {
  return [...items].sort((left, right) => {
    if (sort === "oldest") return right.ageDays - left.ageDays;
    if (sort === "risk")
      return (
        RISK_ORDER[left.risk] - RISK_ORDER[right.risk] ||
        right.ageDays - left.ageDays
      );
    if (sort === "updated")
      return (
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      );
    return (
      SLA_ORDER[slaFor(left)] - SLA_ORDER[slaFor(right)] ||
      RISK_ORDER[left.risk] - RISK_ORDER[right.risk] ||
      right.ageDays - left.ageDays
    );
  });
}

export function activeFilterLabels(filters: QueueFilters) {
  const labels: string[] = [];
  const view = SAVED_VIEWS.find((candidate) => candidate.id === filters.view);
  if (filters.view !== "all" && view) labels.push(`View: ${view.label}`);
  if (filters.text) labels.push(`Search: ${filters.text}`);
  if (filters.type !== "all") labels.push(`Type: ${filters.type}`);
  if (filters.owner !== "all")
    labels.push(`Owner: ${ownerLabel(filters.owner)}`);
  if (filters.backup !== "all")
    labels.push(`Backup: ${ownerLabel(filters.backup)}`);
  if (filters.sla !== "all") labels.push(`SLA: ${filters.sla}`);
  if (filters.risk !== "all") labels.push(`Risk: ${filters.risk}`);
  if (filters.status !== "all") labels.push(`Status: ${filters.status}`);
  if (filters.age !== "all") labels.push(`Age: ${filters.age} days`);
  return labels;
}

export const PEOPLE = [
  { id: "usr_james_kurz", label: "James Kurz", role: "Internal operator" },
  { id: "usr_amina_cole", label: "Amina Cole", role: "Finance approver" },
  { id: "usr_juno_okafor", label: "Juno Okafor", role: "Legal approver" },
] as const;

function ownerLabel(id: string) {
  if (id === "unassigned") return "Unassigned";
  return PEOPLE.find((person) => person.id === id)?.label ?? id;
}

export type OperationalRole =
  | "internal_operator"
  | "finance_approver"
  | "legal_approver"
  | "destructive_action_approver";

export function permittedActions(
  item: QueueItem,
  roles: readonly OperationalRole[],
) {
  if (!item.requiredRole || roles.includes(item.requiredRole))
    return item.permittedActions;
  return item.permittedActions.filter(
    (action) =>
      !/approve|recommendation|legal review|finance review/i.test(action),
  );
}

export function selectQueueItem(
  items: readonly QueueItem[],
  requestedId: string | null,
) {
  return items.find((item) => item.id === requestedId) ?? items[0] ?? null;
}
