import type { Route } from "next";

export { adminSafetyCopy } from "./administration-safety/copy";
export { lifecycleCopy } from "./finance-lifecycle/copy";
export { QUEUE_COPY, SEARCH_COPY } from "./queue-search/copy";

export const internalOpsCopy = {
  home: {
    eyebrow: "Internal operations",
    title: "Operational health",
    description:
      "Act on the exceptions that can affect customers, cash, or service delivery. Monitoring signals are separated from work that needs a decision.",
    refreshed: "Operational snapshot refreshed 4 minutes ago",
    actionHeading: "Recommended actions",
    actionDescription:
      "Ordered by customer impact, policy deadline, and value.",
    monitoringHeading: "Monitoring",
    monitoringDescription:
      "Healthy or contained signals that do not need an operator action right now.",
    healthHeading: "Work requiring action",
    owner: "Owner",
    fresh: "Freshness",
    open: "Open workflow",
    evidence: "Evidence",
  },
  assisted: {
    label: "Assisted mode active",
    effectiveAccount: "Effective account",
    account: "Northstar Archive Labs",
    staffActor: "Staff actor",
    actor: "Morgan Ellis · Internal operator",
    reasonLabel: "Reason",
    reason: "Customer-requested quote correction · CASE-4812",
    authority:
      "Actor authority comes from the server session and cannot be changed here.",
    exit: "Review exit",
  },
} as const;

export type OperationalTone = "critical" | "warning" | "stable" | "info";

export type OperationalSignal = {
  label: string;
  value: string;
  detail: string;
  owner: string;
  freshness: string;
  observedAt: string;
  href: Route;
  action: string;
  tone: OperationalTone;
  truth?: "Estimate" | "Invoice truth" | "Operational truth";
};

export const actionSignals: readonly OperationalSignal[] = [
  {
    label: "Queue breaches",
    value: "12 breached",
    detail: "Four high-risk cases have no backup owner.",
    owner: "Maya Chen",
    freshness: "4 min ago",
    observedAt: "2026-07-31T13:26:00-04:00",
    href: "/internal/queues?view=sla-breached&sort=priority&page=1&pageSize=25",
    action: "Triage breaches",
    tone: "critical",
    truth: "Operational truth",
  },
  {
    label: "Provisioning recovery",
    value: "3 safe retries",
    detail: "Two transient failures can retry; one needs provider escalation.",
    owner: "Provisioning on-call",
    freshness: "7 min ago",
    observedAt: "2026-07-31T13:23:00-04:00",
    href: "/internal/provisioning",
    action: "Review retry safety",
    tone: "critical",
    truth: "Operational truth",
  },
  {
    label: "Collections risk",
    value: "$182,400 overdue",
    detail: "Five invoices are over 45 days; two are disputed.",
    owner: "Avery Stone",
    freshness: "12 min ago",
    observedAt: "2026-07-31T13:18:00-04:00",
    href: "/internal/collections",
    action: "Prioritize collections",
    tone: "warning",
    truth: "Invoice truth",
  },
  {
    label: "Renewal exposure",
    value: "$1.24M estimated",
    detail: "Seven 30-day renewals do not have a confirmed route.",
    owner: "Revenue operations",
    freshness: "18 min ago",
    observedAt: "2026-07-31T13:12:00-04:00",
    href: "/internal/renewals",
    action: "Assign next actions",
    tone: "warning",
    truth: "Estimate",
  },
];

export const monitoringSignals: readonly OperationalSignal[] = [
  {
    label: "Reconciliation state",
    value: "2 pending",
    detail: "No material variance; next ledger refresh is 14:00 ET.",
    owner: "Finance systems",
    freshness: "9 min ago",
    observedAt: "2026-07-31T13:21:00-04:00",
    href: "/internal/reports",
    action: "View reconciliation",
    tone: "stable",
    truth: "Operational truth",
  },
  {
    label: "Provider blockers",
    value: "4 contained",
    detail: "Activation remains disabled until provider tests pass.",
    owner: "Partner operations",
    freshness: "15 min ago",
    observedAt: "2026-07-31T13:15:00-04:00",
    href: "/internal/gates",
    action: "View external gates",
    tone: "info",
    truth: "Operational truth",
  },
];
