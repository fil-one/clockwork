export type RenewalWindow = "30" | "60-90" | "180";

export interface RenewalRecord {
  id: string;
  account: string;
  accountId: string;
  window: RenewalWindow;
  route: "Direct" | "Referral" | "Resale" | "Distributor";
  deadline: string;
  deadlineLabel: string;
  owner: string;
  exposureCents: number;
  invoiceTruth: string;
  collectedTruth: string;
  nextAction: string;
  risk: "High" | "Medium" | "Low";
}

export const renewalWindows = ["30", "60-90", "180"] as const;

export const renewalWindowLabels: Record<RenewalWindow, string> = {
  "30": "Next 30 days",
  "60-90": "60–90 days",
  "180": "Within 180 days",
};

export const renewals: readonly RenewalRecord[] = [
  {
    id: "REN-2026-184",
    account: "Northstar Archive Labs",
    accountId: "11111111-1111-4111-8111-111111111111",
    window: "30",
    route: "Direct",
    deadline: "2026-08-07",
    deadlineLabel: "Aug 7 · 7 days",
    owner: "Amina Cole",
    exposureCents: 184_800_00,
    invoiceTruth: "$15,400 invoiced for July",
    collectedTruth: "$169,400 collected in current term",
    nextAction: "Confirm notice and expansion baseline",
    risk: "High",
  },
  {
    id: "REN-2026-201",
    account: "Halcyon Research Cooperative",
    accountId: "33333333-3333-4333-8333-333333333333",
    window: "30",
    route: "Resale",
    deadline: "2026-08-18",
    deadlineLabel: "Aug 18 · 18 days",
    owner: "James Wu",
    exposureCents: 91_200_00,
    invoiceTruth: "$7,600 invoiced through distributor",
    collectedTruth: "$76,000 collected; partner transfer pending",
    nextAction: "Align reseller notice and end-client route",
    risk: "Medium",
  },
  {
    id: "REN-2026-233",
    account: "Juniper Evidence Systems",
    accountId: "a13276af-e3fd-47b9-90f1-035b7452a213",
    window: "60-90",
    route: "Referral",
    deadline: "2026-10-04",
    deadlineLabel: "Oct 4 · 65 days",
    owner: "Mara Singh",
    exposureCents: 286_400_00,
    invoiceTruth: "$23,867 invoiced for July",
    collectedTruth: "$262,533 collected in current term",
    nextAction: "Validate referral eligibility before outreach",
    risk: "Medium",
  },
  {
    id: "REN-2026-247",
    account: "Solace Public Records",
    accountId: "0af8d9dd-3790-45a2-8f86-c66fa8c18a04",
    window: "60-90",
    route: "Distributor",
    deadline: "2026-10-21",
    deadlineLabel: "Oct 21 · 82 days",
    owner: "Amina Cole",
    exposureCents: 128_000_00,
    invoiceTruth: "$10,667 invoiced by distributor",
    collectedTruth: "$117,333 collected; transfer reconciled",
    nextAction: "Confirm distributor and reseller contacts",
    risk: "Low",
  },
  {
    id: "REN-2026-291",
    account: "Redwood Bioinformatics",
    accountId: "f3e83d8f-b1fc-43ac-a3fc-26071ddcb4af",
    window: "180",
    route: "Direct",
    deadline: "2027-01-12",
    deadlineLabel: "Jan 12 · 165 days",
    owner: "Mara Singh",
    exposureCents: 612_000_00,
    invoiceTruth: "$51,000 invoiced for July",
    collectedTruth: "$561,000 collected in current term",
    nextAction: "Model capacity options; no customer outreach yet",
    risk: "Low",
  },
] as const;

export type DisputeState = "No dispute" | "Evidence due" | "Under review";

export interface CollectionRecord {
  id: string;
  account: string;
  accountId: string;
  overdueCents: number;
  ageDays: number;
  dispute: DisputeState;
  owner: string;
  lastContact: string;
  policyBasis: string;
  nextAction: string;
}

export const collections: readonly CollectionRecord[] = [
  {
    id: "INV-2026-0614",
    account: "Kepler Civic Archive",
    accountId: "1ab4bb1a-6a0f-451e-98fa-2d136faf36ec",
    overdueCents: 84_000_00,
    ageDays: 61,
    dispute: "No dispute",
    owner: "Amina Cole",
    lastContact: "Jul 29 · promised date missed",
    policyBasis:
      "Collections policy §4.2 · finance approval before restriction",
    nextAction: "Review service restriction escalation",
  },
  {
    id: "INV-2026-0661",
    account: "Northstar Archive Labs",
    accountId: "11111111-1111-4111-8111-111111111111",
    overdueCents: 52_800_00,
    ageDays: 46,
    dispute: "Under review",
    owner: "Mara Singh",
    lastContact: "Jul 30 · service-period evidence received",
    policyBasis: "Dispute hold §2.1 · no adverse action during evidence review",
    nextAction: "Route evidence to dispute owner",
  },
  {
    id: "INV-2026-0688",
    account: "Halcyon Research Cooperative",
    accountId: "33333333-3333-4333-8333-333333333333",
    overdueCents: 22_800_00,
    ageDays: 32,
    dispute: "Evidence due",
    owner: "James Wu",
    lastContact: "Jul 28 · evidence due Aug 3",
    policyBasis:
      "Partner collections §3.3 · preserve reseller route and retention",
    nextAction: "Request reseller remittance evidence",
  },
  {
    id: "INV-2026-0702",
    account: "Solace Public Records",
    accountId: "0af8d9dd-3790-45a2-8f86-c66fa8c18a04",
    overdueCents: 15_400_00,
    ageDays: 18,
    dispute: "No dispute",
    owner: "Amina Cole",
    lastContact: "Jul 31 · AP confirmed Aug 5 payment",
    policyBasis:
      "Collections policy §2.2 · monitor within promised-payment window",
    nextAction: "Monitor promised payment",
  },
] as const;

export type FailureClass = "Transient" | "Permanent" | "Waiting";

export interface ProvisioningRecord {
  id: string;
  account: string;
  capability: string;
  provider: string;
  failureClass: FailureClass;
  attempts: number;
  maxAttempts: number;
  idempotencyState: "Verified" | "Missing" | "Not applicable";
  idempotencyKey: string | null;
  lastAttempt: string;
  owner: string;
  escalation: string;
  evidence: string;
}

export const provisioning: readonly ProvisioningRecord[] = [
  {
    id: "PRV-2026-112",
    account: "Northstar Archive Labs",
    capability: "Madrid compliance replica",
    provider: "ArchiveCloud EU",
    failureClass: "Transient",
    attempts: 2,
    maxAttempts: 5,
    idempotencyState: "Verified",
    idempotencyKey: "idem_prv_112_attempt_2",
    lastAttempt: "4 minutes ago",
    owner: "Platform operations",
    escalation: "Escalate after attempt 5 or 30 minutes",
    evidence:
      "Provider timeout after accepted request; lookup confirms no duplicate resource.",
  },
  {
    id: "PRV-2026-119",
    account: "Juniper Evidence Systems",
    capability: "Immutable retention policy",
    provider: "ArchiveCloud US",
    failureClass: "Permanent",
    attempts: 1,
    maxAttempts: 1,
    idempotencyState: "Not applicable",
    idempotencyKey: null,
    lastAttempt: "26 minutes ago",
    owner: "Mara Singh",
    escalation: "Provider and legal review required",
    evidence:
      "Requested retention class is unavailable in the contracted provider region.",
  },
  {
    id: "PRV-2026-125",
    account: "Halcyon Research Cooperative",
    capability: "Reseller delegated administration",
    provider: "IdentityBridge",
    failureClass: "Transient",
    attempts: 3,
    maxAttempts: 4,
    idempotencyState: "Missing",
    idempotencyKey: null,
    lastAttempt: "11 minutes ago",
    owner: "James Wu",
    escalation: "Engineering must restore idempotency evidence",
    evidence:
      "Callback was lost; provider resource existence has not been safely established.",
  },
  {
    id: "PRV-2026-131",
    account: "Solace Public Records",
    capability: "Encryption key activation",
    provider: "KeyCustody",
    failureClass: "Waiting",
    attempts: 1,
    maxAttempts: 3,
    idempotencyState: "Verified",
    idempotencyKey: "idem_prv_131_attempt_1",
    lastAttempt: "7 minutes ago",
    owner: "Platform operations",
    escalation: "Wait for provider activation test until 5:15 PM",
    evidence: "Provider accepted the operation; activation test is pending.",
  },
] as const;

export interface MigrationCandidate {
  id: string;
  name: string;
  detail: string;
  confidence: number;
}

export interface MigrationRecord {
  id: string;
  sourceName: string;
  sourceSystem: string;
  legalEntity: string;
  externalReference: string;
  candidates: readonly MigrationCandidate[];
  evidence: string;
  owner: string;
}

export const migrations: readonly MigrationRecord[] = [
  {
    id: "MIG-2026-016",
    sourceName: "Northstar Archive",
    sourceSystem: "Legacy billing US",
    legalEntity: "Northstar Archive Labs, Inc.",
    externalReference: "legacy-customer-1048",
    candidates: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Northstar Archive Labs",
        detail: "US · Direct buyer · northstar.example",
        confidence: 96,
      },
      {
        id: "4ef7bc88-805b-4aac-842c-21a3b5243c69",
        name: "Northstar Archive Labs UK",
        detail: "UK · Subsidiary · northstar.co.uk",
        confidence: 72,
      },
    ],
    evidence:
      "Tax name matches US entity; legacy email domain is shared by both candidates.",
    owner: "James Wu",
  },
  {
    id: "MIG-2026-021",
    sourceName: "Solace Public Records",
    sourceSystem: "Partner ledger",
    legalEntity: "Solace Public Records Authority",
    externalReference: "partner-ledger-0041",
    candidates: [
      {
        id: "0af8d9dd-3790-45a2-8f86-c66fa8c18a04",
        name: "Solace Public Records",
        detail: "US · Distributor route · solace.example.gov",
        confidence: 99,
      },
    ],
    evidence: "Legal name, tax suffix, and invoice domain agree.",
    owner: "Mara Singh",
  },
  {
    id: "MIG-2026-024",
    sourceName: "Orion Geological Survey",
    sourceSystem: "Legacy CRM EU",
    legalEntity: "Orion Geological Survey GmbH",
    externalReference: "crm-eu-8821",
    candidates: [],
    evidence:
      "No current account shares the legal name, tax suffix, or verified domain.",
    owner: "Amina Cole",
  },
] as const;

export type ValueState = "Estimated" | "Pending reconciliation" | "Final";

export interface ReportMetric {
  period: string;
  estimatedCents: number;
  reconciledCents: number | null;
}

export const reportMetrics: readonly ReportMetric[] = [
  { period: "Apr", estimatedCents: 402_000_00, reconciledCents: 398_200_00 },
  { period: "May", estimatedCents: 431_000_00, reconciledCents: 428_700_00 },
  { period: "Jun", estimatedCents: 467_000_00, reconciledCents: 462_100_00 },
  { period: "Jul", estimatedCents: 503_000_00, reconciledCents: null },
] as const;

export const reportCatalog = [
  {
    name: "revenue_forecast",
    label: "Revenue forecast",
    source: "Quotes, orders, invoices",
    freshness: "Refreshed 8 minutes ago",
    state: "Estimated" as const,
    variance: "+2.8% to operating plan",
  },
  {
    name: "three_way_tie_out",
    label: "Three-way reconciliation",
    source: "Orders, invoices, provider usage",
    freshness: "Refreshed 4 minutes ago",
    state: "Pending reconciliation" as const,
    variance: "$18,400 open variance",
  },
  {
    name: "weekly_scorecard",
    label: "Weekly operating scorecard",
    source: "Finalized finance ledger",
    freshness: "Finalized Jul 28 at 9:00 AM",
    state: "Final" as const,
    variance: "No material variance",
  },
] as const;

export const accountOptions = [
  { id: "", label: "All available accounts" },
  {
    id: "11111111-1111-4111-8111-111111111111",
    label: "Northstar Archive Labs · Direct buyer",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    label: "Halcyon Research Cooperative · Resale",
  },
  {
    id: "0af8d9dd-3790-45a2-8f86-c66fa8c18a04",
    label: "Solace Public Records · Distributor",
  },
] as const;
