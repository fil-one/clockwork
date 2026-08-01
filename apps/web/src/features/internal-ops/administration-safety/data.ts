import type { EvidenceIdentifier, SafetyDecision } from "./policy";

export interface SelectOption {
  id: string;
  label: string;
  description?: string;
}

export interface ApprovalCase extends SelectOption {
  decision: SafetyDecision;
  kind: "Approval" | "Rejection" | "Offboarding" | "Destructive";
  impact: string;
  evidence: readonly string[];
  policyBasis: string;
  downstreamEffect: string;
  owner: string;
  requestedBy: string;
  gates: readonly string[];
  identifiers: readonly EvidenceIdentifier[];
}

export const approvalCases: readonly ApprovalCase[] = [
  {
    id: "EXC-PRC-019",
    label: "Halcyon expansion price exception",
    description: "1.7% below floor · $184,800 annual value",
    decision: "finance",
    kind: "Approval",
    impact: "Approves a below-floor quote for Halcyon Research Cooperative.",
    evidence: [
      "Approved margin worksheet dated Jul 31",
      "Partner tier and floor comparison",
      "Credit exposure remains within the finance threshold",
    ],
    policyBasis:
      "Commercial approval policy CP-4.2; below-floor pricing requires finance authority.",
    downstreamEffect:
      "The quote may proceed to customer review; no order or invoice is created.",
    owner: "James Ortega",
    requestedBy: "Amina Cole",
    gates: ["Credit clear", "Screening clear", "Provider capacity available"],
    identifiers: [
      { label: "Exception case ID", value: "EXC-PRC-019" },
      { label: "Quote ID", value: "88888888-8888-4888-8888-888888888888" },
      {
        label: "Evidence document ID",
        value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    ],
  },
  {
    id: "EXC-LGL-011",
    label: "Northstar customer-paper exception",
    description: "Security addendum · two material variances",
    decision: "legal",
    kind: "Rejection",
    impact:
      "Accepts or rejects customer language that changes the liability and audit terms.",
    evidence: [
      "Counsel redline against CSA v3.2",
      "Security schedule control mapping",
      "Signed-text hash comparison completed",
    ],
    policyBasis:
      "Agreement policy AG-7; material customer-paper variances require counsel approval.",
    downstreamEffect:
      "Approval unlocks counter-signature; rejection returns the redline to the account owner.",
    owner: "Priya Nair",
    requestedBy: "James Ortega",
    gates: [
      "Screening clear",
      "Counsel authority required",
      "Execution provider ready",
    ],
    identifiers: [
      { label: "Exception case ID", value: "EXC-LGL-011" },
      { label: "Agreement ID", value: "99999999-9999-4999-8999-999999999999" },
      {
        label: "Canonical document ID",
        value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    ],
  },
  {
    id: "APR-DEL-003",
    label: "Legacy analytics archive offboarding",
    description: "Retention exclusions · two-person teardown",
    decision: "destructive",
    kind: "Destructive",
    impact:
      "Authorizes deletion of unlocked objects after the retrieval window closes.",
    evidence: [
      "Customer retrieval notice acknowledged",
      "Four Object Lock exclusions preserved through Apr 15, 2027",
      "Final credit and invoice check is clear",
    ],
    policyBasis:
      "Retention and teardown policy RT-9; two distinct approvers and recent authentication are mandatory.",
    downstreamEffect:
      "Creates an approval record only. Automation remains disabled until a second distinct approval and a server-side retention check.",
    owner: "Morgan Ellis",
    requestedBy: "Amina Cole",
    gates: [
      "Requester cannot approve",
      "Second distinct approver required",
      "Retention exclusions preserved",
      "Credit due check clear",
      "Provider deletion remains disabled",
    ],
    identifiers: [
      { label: "Approval case ID", value: "APR-DEL-003" },
      {
        label: "Termination ID",
        value: "55555555-5555-4555-8555-555555555555",
      },
      {
        label: "Retention evidence hash",
        value: "73be9f02a19c7d98b177e4ea8f20f93b",
      },
    ],
  },
] as const;

export const accounts: readonly SelectOption[] = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    label: "Northstar Archive Labs",
    description: "Direct buyer · active",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    label: "Halcyon Research Cooperative",
    description: "Resale end client · renewal in notice",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    label: "Atlas Field Imaging",
    description: "Distributor end client · screening review",
  },
] as const;

export interface AgreementVersion extends SelectOption {
  type: string;
  version: string;
  jurisdiction: string;
  execution: string;
  effectiveOn: string;
  state: "Active" | "Approved" | "Draft" | "Retired";
  scan: string;
  textHash: string;
}

export const agreementVersions: readonly AgreementVersion[] = [
  {
    id: "agtpl_csa_us_3_2",
    label: "Cloud Service Agreement",
    type: "CSA",
    version: "3.2.0",
    jurisdiction: "United States",
    execution: "Click-through",
    effectiveOn: "2026-07-01",
    state: "Active",
    scan: "Canonical text and approval hash match",
    textHash: "sha256:73be9f02…a19c",
  },
  {
    id: "agtpl_csa_us_3_3",
    label: "Cloud Service Agreement",
    type: "CSA",
    version: "3.3.0",
    jurisdiction: "United States",
    execution: "Click-through",
    effectiveOn: "2026-09-01",
    state: "Draft",
    scan: "Counsel note and approval evidence required",
    textHash: "sha256:1844aa21…7d31",
  },
  {
    id: "agtpl_dpa_eu_2_1",
    label: "Data Processing Addendum",
    type: "DPA",
    version: "2.1.0",
    jurisdiction: "European Union",
    execution: "Attached",
    effectiveOn: "2026-06-15",
    state: "Active",
    scan: "Canonical text and approval hash match",
    textHash: "sha256:9e275ca8…cb42",
  },
  {
    id: "agtpl_csa_uk_1_4",
    label: "Cloud Service Agreement",
    type: "CSA",
    version: "1.4.0",
    jurisdiction: "United Kingdom",
    execution: "Counter-signed",
    effectiveOn: "2026-08-15",
    state: "Approved",
    scan: "Activation date is in the future",
    textHash: "sha256:525daa7e…13df",
  },
] as const;

export interface PriceBookVersion extends SelectOption {
  version: string;
  currency: string;
  route: string;
  effectiveOn: string;
  state: "Active" | "Approved" | "Draft" | "Retired";
  skuCount: number;
  scan: string;
  variance: string;
}

export const priceBookVersions: readonly PriceBookVersion[] = [
  {
    id: "pb_usd_2026_3",
    label: "United States rate card",
    version: "2026.3",
    currency: "USD",
    route: "Direct and referral",
    effectiveOn: "2026-07-01",
    state: "Active",
    skuCount: 14,
    scan: "Complete",
    variance: "Final · 0 unresolved floors",
  },
  {
    id: "pb_usd_2026_4",
    label: "United States rate card",
    version: "2026.4",
    currency: "USD",
    route: "Direct and referral",
    effectiveOn: "2026-10-01",
    state: "Draft",
    skuCount: 15,
    scan: "Finance approval pending",
    variance: "Estimated · 3 floor changes",
  },
  {
    id: "pb_eur_2026_2",
    label: "Euro rate card",
    version: "2026.2",
    currency: "EUR",
    route: "Direct, referral, and resale",
    effectiveOn: "2026-07-15",
    state: "Active",
    skuCount: 17,
    scan: "Complete",
    variance: "Final · VAT rules linked",
  },
  {
    id: "pb_gbp_2026_1",
    label: "United Kingdom rate card",
    version: "2026.1",
    currency: "GBP",
    route: "Resale",
    effectiveOn: "2026-08-15",
    state: "Approved",
    skuCount: 12,
    scan: "Activation test pending",
    variance: "Pending reconciliation · 1 transfer floor",
  },
] as const;

export type GateGroup = "Provider" | "Legal" | "Brand" | "Operations";
export interface GateRecord {
  id: string;
  group: GateGroup;
  title: string;
  owner: string;
  capability: string;
  activationTest: string;
  severity: "Launch blocker" | "Path blocker" | "High" | "Medium";
  state: "Active" | "Blocked" | "Review" | "Pending";
  freshness: string;
  reason: string;
  technicalEvidence?: string;
}

export const fallbackGates: readonly GateRecord[] = [
  {
    id: "EXT-PROVIDER-01",
    group: "Provider",
    title: "Production provider selections",
    owner: "Platform owner",
    capability: "E-sign, email, CRM, accounting, screening, and support",
    activationTest: "Simulator passed; production credentials not tested",
    severity: "Path blocker",
    state: "Blocked",
    freshness: "Updated 16 minutes ago",
    reason:
      "Scoped production credentials and named provider choices are required.",
  },
  {
    id: "EXT-PROVISION-01",
    group: "Provider",
    title: "Product provisioning contract",
    owner: "Provisioning lead",
    capability: "Paid service activation",
    activationTest: "Replay-safe simulator passed Jul 31 at 11:42",
    severity: "Path blocker",
    state: "Blocked",
    freshness: "Updated 18 minutes ago",
    reason: "Authenticated product boundary is pending.",
  },
  {
    id: "EXT-LEGAL-01",
    group: "Legal",
    title: "Counsel-approved legal policy",
    owner: "General counsel",
    capability: "Agreement publication and customer-paper approval",
    activationTest: "Version fixtures pass; production hash not supplied",
    severity: "Launch blocker",
    state: "Blocked",
    freshness: "Reviewed today at 10:20",
    reason: "Final hashes, thresholds, and policy versions are pending.",
  },
  {
    id: "EXT-TAX-01",
    group: "Legal",
    title: "Tax and accounting policy",
    owner: "Finance controller",
    capability: "Country billing and tax calculation",
    activationTest: "US, ES, and UK fixtures passed Jul 30",
    severity: "Path blocker",
    state: "Review",
    freshness: "Reviewed yesterday",
    reason: "Accountant approval is required before activation.",
  },
  {
    id: "EXT-BRAND-01",
    group: "Brand",
    title: "Approved production identity",
    owner: "Brand lead",
    capability: "Customer-facing marks, email, and documents",
    activationTest: "Neutral-token visual scan passed",
    severity: "High",
    state: "Review",
    freshness: "Updated 2 hours ago",
    reason: "Approved assets and usage rules are pending.",
  },
  {
    id: "EXT-DOMAIN-01",
    group: "Brand",
    title: "Domains and callback records",
    owner: "Web platform",
    capability: "Custom domains, TLS, callbacks, and sender records",
    activationTest: "Local callback test passed; DNS test not run",
    severity: "Launch blocker",
    state: "Blocked",
    freshness: "Updated 34 minutes ago",
    reason: "Production DNS, TLS, and sender records are not verified.",
  },
  {
    id: "EXT-APPROVERS-01",
    group: "Operations",
    title: "Named operations approvers",
    owner: "Operations director",
    capability: "Queue ownership and segregated approvals",
    activationTest: "Fictional rota coverage passed",
    severity: "Path blocker",
    state: "Blocked",
    freshness: "Updated 1 hour ago",
    reason:
      "Primary, backup, finance, legal, and destructive actors must be named.",
  },
  {
    id: "EXT-TEARDOWN-01",
    group: "Operations",
    title: "Teardown authority",
    owner: "Security operations",
    capability: "Retention-aware deletion",
    activationTest: "Two-person simulation passed; automation disabled",
    severity: "Launch blocker",
    state: "Pending",
    freshness: "Tested today at 09:15",
    reason:
      "Recent-authentication and provider authority tests remain pending.",
  },
] as const;
