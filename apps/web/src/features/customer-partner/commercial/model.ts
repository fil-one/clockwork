export const collectionKinds = [
  "agreements",
  "quotes",
  "orders",
  "services",
  "pocs",
  "billing",
] as const;

export type CollectionKind = (typeof collectionKinds)[number];
export type CommercialRisk = "low" | "medium" | "high";
export type CommercialTone = "neutral" | "success" | "warning" | "danger";

export interface CommercialRecord {
  id: string;
  kind: CollectionKind;
  title: string;
  description: string;
  status: string;
  statusLabel: string;
  tone: CommercialTone;
  risk: CommercialRisk;
  owner: string;
  value: string;
  valueLabel: string;
  updatedAt: string;
  dateLabel: string;
  href: string;
  term: string;
  nextAction: string;
  version?: string;
  projectionId?: string;
  aggregateId?: string;
  allowedActions?: readonly string[];
}

export interface CollectionDefinition {
  kind: CollectionKind;
  eyebrow: string;
  title: string;
  description: string;
  valueHeading: string;
  primaryAction?: { label: string; href: Route };
}

export const collectionDefinitions: Record<
  CollectionKind,
  CollectionDefinition
> = {
  agreements: {
    kind: "agreements",
    eyebrow: "Legal",
    title: "Agreements",
    description:
      "Review governing terms, versions, authority evidence, and execution state.",
    valueHeading: "Term end",
    primaryAction: {
      label: "Review agreement",
      href: "/agreements/execute",
    },
  },
  quotes: {
    kind: "quotes",
    eyebrow: "Commercial",
    title: "Quotes",
    description:
      "Compare draft, open, accepted, and canceled offers before taking a valid next action.",
    valueHeading: "Estimated spend",
    primaryAction: { label: "Create quote", href: "/quotes/new" },
  },
  orders: {
    kind: "orders",
    eyebrow: "Commitments",
    title: "Orders",
    description:
      "Track accepted commitments, purchase orders, service starts, and provisioning.",
    valueHeading: "Commitment",
    primaryAction: { label: "Accept an order", href: "/orders/accept" },
  },
  services: {
    kind: "services",
    eyebrow: "Services",
    title: "Orders & services",
    description:
      "Monitor active capacity, regional delivery, provisioning, and service term state.",
    valueHeading: "Usage",
  },
  pocs: {
    kind: "pocs",
    eyebrow: "Evaluation",
    title: "Proofs of concept",
    description:
      "Review test scope, safeguards, expiry, results, and conversion readiness.",
    valueHeading: "Time remaining",
  },
  billing: {
    kind: "billing",
    eyebrow: "Billing",
    title: "Billing & payments",
    description:
      "Use invoice and provider-confirmed payment truth separately from estimated spend.",
    valueHeading: "Invoiced amount",
  },
};

export const commercialRecords: readonly CommercialRecord[] = [
  {
    id: "AGR-2026-0042",
    kind: "agreements",
    title: "Cloud Service Agreement",
    description: "Fil One paper · version 3.2 · signed by Maya Chen",
    status: "active",
    statusLabel: "Active",
    tone: "success",
    risk: "low",
    owner: "Maya Chen",
    value: "Dec 31, 2026",
    valueLabel: "Term end",
    updatedAt: "2026-07-30T15:40:00Z",
    dateLabel: "Updated Jul 30",
    href: "/agreements/AGR-2026-0042",
    term: "Jan 1–Dec 31, 2026 · notice opens Nov 1",
    nextAction: "No action due",
    version: "3.2",
  },
  {
    id: "AGR-2026-0061",
    kind: "agreements",
    title: "Customer security addendum",
    description: "Customer paper · four key terms in legal review",
    status: "review",
    statusLabel: "Review required",
    tone: "warning",
    risk: "high",
    owner: "Legal team",
    value: "Aug 5, 2026",
    valueLabel: "Response due",
    updatedAt: "2026-07-31T12:10:00Z",
    dateLabel: "Updated 4 hours ago",
    href: "/agreements/AGR-2026-0061",
    term: "Pending execution",
    nextAction: "Review negotiated terms",
    version: "1.4",
  },
  {
    id: "AGR-2026-0017",
    kind: "agreements",
    title: "Data Processing Addendum",
    description: "EU variant · version 2.1 · attached to governing agreement",
    status: "active",
    statusLabel: "Active",
    tone: "success",
    risk: "low",
    owner: "Maya Chen",
    value: "Jun 30, 2027",
    valueLabel: "Term end",
    updatedAt: "2026-07-28T09:00:00Z",
    dateLabel: "Updated Jul 28",
    href: "/agreements/AGR-2026-0017",
    term: "Co-terminous with the Cloud Service Agreement",
    nextAction: "No action due",
    version: "2.1",
  },
  {
    id: "Q-2026-0184-v3",
    kind: "quotes",
    title: "Enterprise committed capacity",
    description: "400 TB · US East · annual · direct",
    status: "open",
    statusLabel: "Open",
    tone: "warning",
    risk: "medium",
    owner: "Maya Chen",
    value: "$184,800.00",
    valueLabel: "Estimated annual spend",
    updatedAt: "2026-07-31T13:20:00Z",
    dateLabel: "Expires Aug 4",
    href: "/quotes/Q-2026-0184-v3",
    term: "12 months · expires Aug 4, 2026",
    nextAction: "Accept or cancel before expiry",
    version: "3",
  },
  {
    id: "Q-2026-0171-v1",
    kind: "quotes",
    title: "Annual business expansion",
    description: "80 TB · EU West · monthly commit · direct",
    status: "draft",
    statusLabel: "Draft",
    tone: "neutral",
    risk: "low",
    owner: "Jordan Lee",
    value: "€31,680.00",
    valueLabel: "Estimated annual spend",
    updatedAt: "2026-07-29T10:30:00Z",
    dateLabel: "Updated Jul 29",
    href: "/quotes/Q-2026-0171-v1",
    term: "12 months · expiry set when issued",
    nextAction: "Finish and issue quote",
    version: "1",
  },
  {
    id: "Q-2026-0165-v2",
    kind: "quotes",
    title: "Compliance replica renewal",
    description: "120 TB · UK South · annual · direct",
    status: "accepted",
    statusLabel: "Accepted",
    tone: "success",
    risk: "low",
    owner: "Maya Chen",
    value: "$55,440.00",
    valueLabel: "Accepted estimated spend",
    updatedAt: "2026-07-25T14:00:00Z",
    dateLabel: "Accepted Jul 25",
    href: "/quotes/Q-2026-0165-v2",
    term: "12 months · accepted Jul 25, 2026",
    nextAction: "Review and accept resulting order",
    version: "2",
  },
  {
    id: "Q-2026-0140-v1",
    kind: "quotes",
    title: "Short-term migration buffer",
    description: "40 TB · US East · three months · direct",
    status: "canceled",
    statusLabel: "Canceled",
    tone: "neutral",
    risk: "low",
    owner: "Maya Chen",
    value: "$4,620.00",
    valueLabel: "Canceled estimate",
    updatedAt: "2026-07-18T11:00:00Z",
    dateLabel: "Canceled Jul 18",
    href: "/quotes/Q-2026-0140-v1",
    term: "Canceled before acceptance",
    nextAction: "No actions available",
    version: "1",
  },
  {
    id: "ORD-2026-0098",
    kind: "orders",
    title: "Northstar primary archive",
    description: "PO-NA-1048 · 500 TB · US East · direct",
    status: "active",
    statusLabel: "Active",
    tone: "success",
    risk: "low",
    owner: "Service operations",
    value: "$184,800 annual",
    valueLabel: "Committed annual spend",
    updatedAt: "2026-07-31T14:10:00Z",
    dateLabel: "Started Jan 1",
    href: "/orders/ORD-2026-0098",
    term: "Jan 1–Dec 31, 2026 · auto-renews",
    nextAction: "Renewal notice opens Nov 1",
  },
  {
    id: "ORD-2026-0112",
    kind: "orders",
    title: "Madrid compliance replica",
    description: "PO-NA-1081 · 120 TB · EU West · direct",
    status: "provisioning",
    statusLabel: "Provisioning",
    tone: "warning",
    risk: "medium",
    owner: "Service operations",
    value: "$55,440 annual",
    valueLabel: "Committed annual spend",
    updatedAt: "2026-07-31T14:00:00Z",
    dateLabel: "Starts Aug 1",
    href: "/orders/ORD-2026-0112",
    term: "Aug 1, 2026–Jul 31, 2027",
    nextAction: "Complete provisioning checklist",
  },
  {
    id: "SVC-PRIMARY-01",
    kind: "services",
    title: "Northstar primary archive",
    description: "500 TB committed · 311 TB stored · US East",
    status: "active",
    statusLabel: "Active",
    tone: "success",
    risk: "low",
    owner: "Service operations",
    value: "62% used",
    valueLabel: "Capacity usage",
    updatedAt: "2026-07-31T15:42:00Z",
    dateLabel: "Metered 18 min ago",
    href: "/orders/ORD-2026-0098",
    term: "Ends Dec 31, 2026",
    nextAction: "No action due",
  },
  {
    id: "SVC-REPLICA-02",
    kind: "services",
    title: "Madrid compliance replica",
    description: "120 TB committed · provisioning at 78% · EU West",
    status: "provisioning",
    statusLabel: "Provisioning",
    tone: "warning",
    risk: "medium",
    owner: "Service operations",
    value: "78% ready",
    valueLabel: "Provisioning",
    updatedAt: "2026-07-31T14:00:00Z",
    dateLabel: "Updated 2 hours ago",
    href: "/orders/ORD-2026-0112",
    term: "Starts Aug 1, 2026",
    nextAction: "Confirm encryption key handoff",
  },
  {
    id: "POC-2026-0031",
    kind: "pocs",
    title: "Telemetry archive recovery",
    description: "20 TB cap · final report Aug 7 · confidential data permitted",
    status: "active",
    statusLabel: "Active",
    tone: "success",
    risk: "medium",
    owner: "Amina Cole",
    value: "7 days left",
    valueLabel: "Time remaining",
    updatedAt: "2026-07-31T11:20:00Z",
    dateLabel: "Expires Aug 7",
    href: "/pocs/POC-2026-0031",
    term: "Expires Aug 7, 2026 · isolated environment",
    nextAction: "Complete restore validation",
  },
  {
    id: "POC-2026-0024",
    kind: "pocs",
    title: "Immutable legal records",
    description: "12 TB · four of four success tests passed",
    status: "complete",
    statusLabel: "Complete",
    tone: "success",
    risk: "low",
    owner: "Amina Cole",
    value: "Ready to convert",
    valueLabel: "Outcome",
    updatedAt: "2026-07-27T15:00:00Z",
    dateLabel: "Completed Jul 27",
    href: "/pocs/POC-2026-0024",
    term: "Evaluation complete · data retained in place",
    nextAction: "Review paid conversion",
  },
  {
    id: "INV-2026-0781",
    kind: "billing",
    title: "July committed capacity",
    description: "Invoice for Northstar primary archive · PO-NA-1048",
    status: "open",
    statusLabel: "Open",
    tone: "warning",
    risk: "medium",
    owner: "Accounts payable",
    value: "$15,400.00",
    valueLabel: "Invoiced amount",
    updatedAt: "2026-07-31T08:00:00Z",
    dateLabel: "Due Aug 8",
    href: "/billing/INV-2026-0781",
    term: "Service period Jul 1–31, 2026",
    nextAction: "Review and pay by Aug 8",
  },
  {
    id: "INV-2026-0712",
    kind: "billing",
    title: "June committed capacity",
    description: "Receipt RCPT-2026-0712 · ACH ending 1842",
    status: "paid",
    statusLabel: "Paid",
    tone: "success",
    risk: "low",
    owner: "Accounts payable",
    value: "$15,400.00",
    valueLabel: "Invoiced amount",
    updatedAt: "2026-07-03T16:25:00Z",
    dateLabel: "Provider confirmed Jul 3",
    href: "/billing/INV-2026-0712",
    term: "Service period Jun 1–30, 2026",
    nextAction: "No action due",
  },
] as const;

export function recordsFor(kind: CollectionKind): readonly CommercialRecord[] {
  return commercialRecords.filter((record) => record.kind === kind);
}

export function recordById(id: string): CommercialRecord | undefined {
  return commercialRecords.find((record) => record.id === id);
}
import type { Route } from "next";
