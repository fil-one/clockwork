import type { MessageId } from "@/src/i18n/en";

export const DEMO_NOW = new Date("2026-07-31T16:00:00Z");

export const signingFixture = {
  reference: "AGR-2026-0042 · v3.2",
  account: "Northstar Archive Labs",
  term: "Jan 1 — Dec 31, 2026",
  envelope: "env_demo_0042",
  status: "completed",
  hash: "73be9f02",
} as const;

export type Tone = "neutral" | "success" | "warning" | "danger";
export interface DemoRecord {
  id: string;
  title: string;
  meta: string;
  status: MessageId;
  tone: Tone;
  value?: string;
  risk?: "low" | "medium" | "high";
}

export const accounts = [
  {
    id: "acct_northstar",
    name: "Northstar Archive Labs",
    role: "Direct buyer",
  },
  { id: "acct_meridian", name: "Meridian Channel Group", role: "Reseller" },
  { id: "acct_filone", name: "Fil One Operations", role: "Internal" },
] as const;

export const agreements: readonly DemoRecord[] = [
  {
    id: "AGR-2026-0042",
    title: "Cloud Service Agreement",
    meta: "Fil One paper · v3.2 · signed by Maya Chen",
    status: "status.active",
    tone: "success",
    value: "Dec 31, 2026",
  },
  {
    id: "AGR-2026-0017",
    title: "Data Processing Addendum",
    meta: "EU variant · v2.1 · attached automatically",
    status: "status.signed",
    tone: "success",
    value: "Jun 30, 2027",
  },
  {
    id: "AGR-2026-0061",
    title: "Customer security addendum",
    meta: "Customer paper · key terms reviewed",
    status: "status.review",
    tone: "warning",
    value: "Legal review",
  },
] as const;

export const quotes: readonly DemoRecord[] = [
  {
    id: "Q-2026-0184-v3",
    title: "Enterprise committed capacity",
    meta: "400 TB · us-east · annual · price book USD-2026.3",
    status: "status.awaiting",
    tone: "warning",
    value: "$184,800.00",
  },
  {
    id: "Q-2026-0171-v1",
    title: "Annual business expansion",
    meta: "80 TB · eu-west · monthly commit",
    status: "status.draft",
    tone: "neutral",
    value: "€31,680.00",
  },
] as const;

export const orders: readonly DemoRecord[] = [
  {
    id: "ORD-2026-0098",
    title: "Northstar primary archive",
    meta: "PO-NA-1048 · 500 TB · us-east · direct",
    status: "status.active",
    tone: "success",
    value: "311 TB stored",
  },
  {
    id: "ORD-2026-0112",
    title: "Madrid compliance replica",
    meta: "PO-NA-1081 · 120 TB · eu-west · amendment pending",
    status: "status.provisioning",
    tone: "warning",
    value: "78% complete",
  },
] as const;

export const pocs: readonly DemoRecord[] = [
  {
    id: "POC-2026-0031",
    title: "Telemetry archive recovery",
    meta: "20 TB cap · final report Aug 7 · owner Amina Cole",
    status: "status.active",
    tone: "success",
    value: "7 days left",
  },
  {
    id: "POC-2026-0024",
    title: "Immutable legal records",
    meta: "12 TB · 4 of 4 success tests",
    status: "status.complete",
    tone: "success",
    value: "Ready to convert",
  },
] as const;

export const invoices: readonly DemoRecord[] = [
  {
    id: "INV-2026-0781",
    title: "Northstar Archive Labs",
    meta: "PO-NA-1048 · ACH ending 1842 · sales tax exempt",
    status: "status.awaiting",
    tone: "warning",
    value: "$15,400.00",
  },
  {
    id: "INV-2026-0712",
    title: "Northstar Archive Labs",
    meta: "Receipt RCPT-2026-0712 · paid Jul 3",
    status: "status.paid",
    tone: "success",
    value: "$15,400.00",
  },
] as const;

export const endClients: readonly DemoRecord[] = [
  {
    id: "EC-0038",
    title: "Halcyon Research Cooperative",
    meta: "Resale · 280 TB · renewal action due Sep 2",
    status: "status.inNotice",
    tone: "warning",
    value: "$91,200 transfer",
    risk: "medium",
  },
  {
    id: "EC-0041",
    title: "Solace Public Records",
    meta: "Referral · 65 TB · commission eligible",
    status: "status.active",
    tone: "success",
    value: "$28,600 collected",
    risk: "low",
  },
  {
    id: "EC-0047",
    title: "Atlas Field Imaging",
    meta: "Distributor > reseller · POC active · 14 TB",
    status: "status.review",
    tone: "warning",
    value: "Qualification due",
    risk: "high",
  },
] as const;

export const queues: readonly DemoRecord[] = [
  {
    id: "EXC-PRC-019",
    title: "Pricing · Halcyon expansion",
    meta: "Owner James · backup Amina · due today at 5:00 PM",
    status: "status.review",
    tone: "warning",
    value: "1.7% below floor",
    risk: "medium",
  },
  {
    id: "EXC-LGL-011",
    title: "Legal · customer paper",
    meta: "Owner counsel · backup triage only · 2 days remaining",
    status: "status.pending",
    tone: "neutral",
    value: "4 key terms",
    risk: "medium",
  },
  {
    id: "EXC-COL-008",
    title: "Collections · aging decision",
    meta: "Owner Amina · retention locked through 2027-04-15",
    status: "status.blocked",
    tone: "danger",
    value: "$22,800 overdue",
    risk: "high",
  },
  {
    id: "EXC-SCR-004",
    title: "Restricted parties · possible name match",
    meta: "Owner James + counsel · no backup · transaction blocked",
    status: "status.blocked",
    tone: "danger",
    value: "Manual clearance",
    risk: "high",
  },
  {
    id: "EXC-DSP-012",
    title: "Invoice dispute · service period",
    meta: "Owner James · backup Amina · evidence due Aug 3",
    status: "status.review",
    tone: "warning",
    value: "$8,460 disputed",
    risk: "medium",
  },
  {
    id: "EXC-REG-007",
    title: "Deal registration · competing claim",
    meta: "Owner James · tiebreak basis must be recorded",
    status: "status.pending",
    tone: "neutral",
    value: "2 partner claims",
    risk: "medium",
  },
  {
    id: "EXC-POC-021",
    title: "POC qualification · Atlas imaging",
    meta: "Owner James · backup Amina · target today",
    status: "status.review",
    tone: "warning",
    value: "14 TB cap",
    risk: "low",
  },
  {
    id: "APR-DEL-003",
    title: "Destructive approval · retention exclusions",
    meta: "Two distinct approvers required · automation disabled",
    status: "status.blocked",
    tone: "danger",
    value: "Manual safe path",
    risk: "high",
  },
  {
    id: "APR-MIG-016",
    title: "Migration review · ambiguous legal entity",
    meta: "No account will be created until the match is resolved",
    status: "status.pending",
    tone: "neutral",
    value: "3 candidate records",
    risk: "medium",
  },
] as const;

export const gates: readonly DemoRecord[] = [
  {
    id: "EXT-ACC-01",
    title: "Hosted accounts and credentials",
    meta: "Provider fakes active · scoped production credentials pending",
    status: "status.blocked",
    tone: "danger",
    value: "Path blocker",
  },
  {
    id: "EXT-LEGAL-01",
    title: "Counsel-approved legal policy",
    meta: "Versioned fixtures active · final hashes, thresholds, and rules pending",
    status: "status.blocked",
    tone: "danger",
    value: "Launch blocker",
  },
  {
    id: "EXT-BRAND-01",
    title: "Brand approval",
    meta: "Text mark and neutral tokens active · approved assets pending",
    status: "status.review",
    tone: "warning",
    value: "High",
  },
  {
    id: "EXT-COMMERCIAL-01",
    title: "Commercial inputs",
    meta: "Fictional USD, EUR, and GBP books cover demo and CI",
    status: "status.blocked",
    tone: "danger",
    value: "Launch blocker",
  },
  {
    id: "EXT-PROVIDER-01",
    title: "Provider selections",
    meta: "Contract fakes active · e-sign, email, CRM, QBO, screening, and support choices pending",
    status: "status.blocked",
    tone: "danger",
    value: "Path blocker",
  },
  {
    id: "EXT-PROVISION-01",
    title: "Product provisioning contract",
    meta: "Replay-safe simulator active · authenticated product boundary pending",
    status: "status.blocked",
    tone: "danger",
    value: "Paid activation",
  },
  {
    id: "EXT-TAX-01",
    title: "Tax and accounting policy",
    meta: "US, ES, and UK fixtures active · accountant approval pending",
    status: "status.blocked",
    tone: "danger",
    value: "Country blocker",
  },
  {
    id: "EXT-DOMAIN-01",
    title: "Domains and callback records",
    meta: "Deterministic local callbacks active · DNS, TLS, and sender records pending",
    status: "status.blocked",
    tone: "danger",
    value: "Launch blocker",
  },
  {
    id: "EXT-APPROVERS-01",
    title: "Named operations approvers",
    meta: "Fictional rota active · primary, backup, finance, legal, and destructive names pending",
    status: "status.blocked",
    tone: "danger",
    value: "Operations blocker",
  },
  {
    id: "EXT-TEARDOWN-01",
    title: "Teardown authority",
    meta: "Two-person workflow simulated; automation remains disabled",
    status: "status.pending",
    tone: "neutral",
    value: "Manual safe path",
  },
  {
    id: "EXT-MARKETPLACE-01",
    title: "Marketplace enrollment",
    meta: "AWS, Azure, and GCP settlement simulators active · enrollments and payout access pending",
    status: "status.blocked",
    tone: "danger",
    value: "Channel blocker",
  },
  {
    id: "EXT-MIGRATION-01",
    title: "Production migration window",
    meta: "Snapshot rehearsal active · legacy source access and quiet-day approval pending",
    status: "status.pending",
    tone: "neutral",
    value: "Post-launch gate",
  },
] as const;

export const marketplaceRecords: readonly DemoRecord[] = [
  {
    id: "AWS-OFFER-1948",
    title: "AWS Marketplace private offer",
    meta: "Northstar Archive Labs · fulfillment synchronized Jul 31",
    status: "status.active",
    tone: "success",
    value: "$184,800 annual",
  },
  {
    id: "AZURE-OFFER-0412",
    title: "Azure Marketplace transactable offer",
    meta: "UK reseller preview · buyer has not accepted",
    status: "status.pending",
    tone: "neutral",
    value: "£72,990 annual",
  },
  {
    id: "GCP-OFFER-0087",
    title: "Google Cloud Marketplace offer",
    meta: "Read-only provider feed · disbursement pending",
    status: "status.awaiting",
    tone: "warning",
    value: "€31,680 annual",
  },
] as const;

export const supportTickets: readonly DemoRecord[] = [
  {
    id: "SUP-18421",
    title: "Restore sample timing",
    meta: "Northstar Archive Labs · support system is source · updated 28 min ago",
    status: "status.active",
    tone: "success",
    value: "Normal priority",
  },
  {
    id: "SUP-18307",
    title: "EU usage export",
    meta: "Halcyon Research Cooperative · partner-visible summary",
    status: "status.pending",
    tone: "neutral",
    value: "Awaiting customer",
  },
] as const;

export const users: readonly DemoRecord[] = [
  {
    id: "USR-MAYA",
    title: "Maya Chen",
    meta: "Owner · MFA verified · all commerce approvals",
    status: "status.active",
    tone: "success",
    value: "Last active today",
  },
  {
    id: "USR-ELIAS",
    title: "Elias Romero",
    meta: "Billing · invoices, payments, and tax records",
    status: "status.active",
    tone: "success",
    value: "$50,000 limit",
  },
  {
    id: "INV-JUNO",
    title: "Juno Okafor",
    meta: "Legal approver · invitation expires Aug 6",
    status: "status.pending",
    tone: "neutral",
    value: "Invite sent",
  },
] as const;

export const procurementRecords: readonly DemoRecord[] = [
  {
    id: "PROC-AP",
    title: "Accounts payable routing",
    meta: "ap@northstar.example · invoices and credits",
    status: "status.complete",
    tone: "success",
    value: "Verified",
  },
  {
    id: "PROC-COUPA",
    title: "Coupa supplier onboarding",
    meta: "Owner Elias Romero · recurring task due Aug 12",
    status: "status.awaiting",
    tone: "warning",
    value: "Bank check pending",
  },
  {
    id: "TAX-US-019",
    title: "US resale exemption",
    meta: "Jurisdiction NY · document retained · expires Mar 31, 2027",
    status: "status.active",
    tone: "success",
    value: "Sales tax exempt",
  },
] as const;

export const offboardingRecords: readonly DemoRecord[] = [
  {
    id: "OFF-2026-0019",
    title: "Legacy analytics archive",
    meta: "Retrieval window ends Aug 15 · final invoice drafted",
    status: "status.awaiting",
    tone: "warning",
    value: "Two-person teardown",
  },
  {
    id: "CERT-2026-0007",
    title: "Deletion certificate",
    meta: "Unlocked objects deleted Jul 18 · immutable evidence retained",
    status: "status.complete",
    tone: "success",
    value: "4 locked exclusions",
  },
  {
    id: "RET-2027-0415",
    title: "Object Lock retention exclusion",
    meta: "Customer liability rule: through retention expiry",
    status: "status.blocked",
    tone: "danger",
    value: "Apr 15, 2027",
  },
] as const;

export const registrations: readonly DemoRecord[] = [
  {
    id: "REG-2026-0081",
    title: "Atlas Field Imaging",
    meta: "Distributor > reseller · 45-day protection · 320 TB",
    status: "status.review",
    tone: "warning",
    value: "Decision due today",
    risk: "medium",
  },
  {
    id: "REG-2026-0074",
    title: "Solace Public Records",
    meta: "Referral · sourced credit · converted to ORD-2026-0108",
    status: "status.complete",
    tone: "success",
    value: "$28,600 collected",
    risk: "low",
  },
  {
    id: "REG-2026-0062",
    title: "House account challenge",
    meta: "Two competing claims · tiebreak evidence preserved",
    status: "status.pending",
    tone: "neutral",
    value: "3 days remaining",
    risk: "high",
  },
] as const;

export const commissionRecords: readonly DemoRecord[] = [
  {
    id: "STM-2026-Q3",
    title: "Q3 commission statement",
    meta: "34 collections · 2 credits · 1 holdback",
    status: "status.pending",
    tone: "neutral",
    value: "$18,420.00",
  },
  {
    id: "ACC-2026-0712",
    title: "Solace Public Records referral",
    meta: "10% of net collected revenue · invoice INV-2026-0712",
    status: "status.active",
    tone: "success",
    value: "$2,860.00",
  },
  {
    id: "CLAW-2026-009",
    title: "Credit-note clawback",
    meta: "Negative accrual · reason code service credit",
    status: "status.complete",
    tone: "success",
    value: "−$480.00",
  },
] as const;

export const sandboxes: readonly DemoRecord[] = [
  {
    id: "SBX-2026-014",
    title: "Meridian presales lab",
    meta: "10 TB · us-east · named keys · expires Aug 31",
    status: "status.active",
    tone: "success",
    value: "42% used",
  },
  {
    id: "SBX-2026-011",
    title: "Distributor enablement",
    meta: "20 TB · uk-south · support owner Juno",
    status: "status.inNotice",
    tone: "warning",
    value: "6 days left",
  },
] as const;

export const priceBooks: readonly DemoRecord[] = [
  {
    id: "PB-USD-2026.3",
    title: "United States rate card",
    meta: "14 SKUs · floors active · Stripe tax codes complete",
    status: "status.active",
    tone: "success",
    value: "Effective Jul 1",
  },
  {
    id: "PB-EUR-2026.2",
    title: "Euro rate card",
    meta: "EU regions · VAT reverse charge · partner tiers",
    status: "status.active",
    tone: "success",
    value: "Effective Jul 15",
  },
  {
    id: "PB-GBP-2026.1",
    title: "United Kingdom rate card",
    meta: "BACS enabled · reseller transfer tier pending approval",
    status: "status.review",
    tone: "warning",
    value: "1 missing floor",
  },
] as const;

export const provisioningRecords: readonly DemoRecord[] = [
  {
    id: "RUN-PRV-4418",
    title: "Madrid compliance replica",
    meta: "Transient orchestrator timeout · original idempotency key retained",
    status: "status.review",
    tone: "warning",
    value: "Safe to re-drive",
    risk: "medium",
  },
  {
    id: "RUN-PRV-4391",
    title: "Halcyon archive expansion",
    meta: "Confirmation arrived before projection · deduplicated",
    status: "status.complete",
    tone: "success",
    value: "No action",
    risk: "low",
  },
  {
    id: "RUN-PRV-4377",
    title: "Atlas POC tenant",
    meta: "Permanent region restriction · entitlement unchanged",
    status: "status.blocked",
    tone: "danger",
    value: "Manual resolution",
    risk: "high",
  },
] as const;

export const reportRecords: readonly DemoRecord[] = [
  {
    id: "RPT-FORECAST-0731",
    title: "Revenue forecast",
    meta: "Committed backlog separated from pipeline · amendments netted",
    status: "status.ready",
    tone: "success",
    value: "$3.84M",
  },
  {
    id: "RPT-CAPACITY-0731",
    title: "Regional capacity plan",
    meta: "Commit, provisioned capacity, and actual bytes",
    status: "status.ready",
    tone: "success",
    value: "2.8 PB",
  },
  {
    id: "REC-2026-07",
    title: "Stripe / QBO / platform tie-out",
    meta: "37 invoices · AR at issuance · tax liabilities",
    status: "status.complete",
    tone: "success",
    value: "0.0% variance",
  },
  {
    id: "RPT-MARGIN-0731",
    title: "Realized margin and POC cost",
    meta: "Orchestrator cost ingested at entitlement grain",
    status: "status.ready",
    tone: "success",
    value: "68.4%",
  },
] as const;

export const migrationRecords: readonly DemoRecord[] = [
  {
    id: "MIG-2026-0038",
    title: "Northstar Labs / Northstar Archive Labs",
    meta: "Legal name differs · Stripe customer and domain agree",
    status: "status.review",
    tone: "warning",
    value: "Human match required",
    risk: "medium",
  },
  {
    id: "MIG-2026-0041",
    title: "Legacy PAYG acceptance",
    meta: "Exact ToS version unavailable · re-acceptance will be requested",
    status: "status.pending",
    tone: "neutral",
    value: "Quiet-day batch",
    risk: "low",
  },
] as const;

export const timeline = [
  {
    at: "Jul 31 · 3:42 PM",
    title: "Quote Q-2026-0184-v3 issued",
    detail: "Maya Chen · portal",
  },
  {
    at: "Jul 31 · 2:06 PM",
    title: "Usage projection reconciled",
    detail: "System · 0.0% variance",
  },
  {
    at: "Jul 30 · 11:18 AM",
    title: "Invoice INV-2026-0781 delivered",
    detail: "System · AP and billing owner",
  },
  {
    at: "Jul 29 · 4:51 PM",
    title: "Agreement evidence verified",
    detail: "Amina Cole assisted Maya Chen",
  },
] as const;

export const usageSeries = [38, 46, 54, 61, 68, 72] as const;
export const spendSeries = [12400, 12400, 13800, 14600, 15400, 15400] as const;
export const capacitySeries = [62, 78, 54, 88, 69, 91] as const;
