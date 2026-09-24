import type { AcceptedOrder } from "@clockwork/domain/core";
import { demoAccountIds } from "@clockwork/testing/personas";

import { formatMoney } from "@/src/features/shared/format";

import { demoUuid } from "./demo-artifact-catalog";
import type { ExperienceAudience, ProjectionChannel } from "./model";

/**
 * The demo's per-account portal records.
 *
 * Two things live here, and both exist because the demo used to be MORE
 * PERMISSIVE than the product.
 *
 * 1. `demoRecordAccounts` names the account that owns each record in the shared
 *    fixture arrays. The persisted projection filters `audience_account_id` and
 *    the row policy repeats the test, so a demo that answered every persona
 *    with every record was showing something the product refuses.
 *
 * 2. `demoAdditionalRecords` is what makes that filter safe to switch on.
 *    Refusing a read is only correct when the reader has their own records to
 *    read; a filter that emptied six of the nine personas' portals would be a
 *    control that blocks legitimate work, which is the worse failure. Every
 *    account that can reach a surface has a record on it, and the demo journeys
 *    each land on a record that exists.
 */

const DIRECT = demoAccountIds.direct;
const REFERRAL = demoAccountIds.referral;
const RESELLER = demoAccountIds.reseller;
const DISTRIBUTOR = demoAccountIds.distributor;
const END_CLIENT = demoAccountIds.endClient;
const UK_END_CLIENT = demoAccountIds.ukEndClient;

const updatedAt = "2026-07-31T15:00:00.000Z";
const MERIDIAN_ORDER_ID = demoUuid("subject:order:ORD-2026-0098");
const MERIDIAN_INVOICE_ID = demoUuid("subject:invoice:INV-2026-0781");
const RENEWAL_REPORT_ID = demoUuid("subject:report_export:RPT-2026-07");
const RENEWAL_REPORT_DOCUMENT_ID = demoUuid(
  "document:report_export:RPT-2026-07",
);

export interface DemoPortalRecord {
  readonly audience: ExperienceAudience;
  readonly channel: ProjectionChannel;
  readonly key: string;
  readonly accountId: string | null;
  /** The domain aggregate, distinct from the materialized projection row. */
  readonly aggregateType?: string;
  readonly aggregateId?: string;
  readonly version: number;
  readonly updatedAt: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * `audience:channel:recordKey` to the owning account.
 *
 * The partner book splits cleanly along the story the fixtures already tell:
 * the Halcyon and Orchid records are resale (Ember Peak), the Solace records
 * are referral (Northstar Advisory), and the Atlas records are two-tier
 * (Harborline). Nothing was invented to make the split work.
 */
export const demoRecordAccounts: Readonly<Record<string, string>> = {
  "partner:portfolio:EC-0038": RESELLER,
  "partner:portfolio:EC-0041": REFERRAL,
  "partner:portfolio:EC-0047": DISTRIBUTOR,
  "partner:registrations:REG-2026-0081": DISTRIBUTOR,
  "partner:registrations:REG-2026-0074": REFERRAL,
  "partner:registrations:REG-2026-0062": RESELLER,
  "partner:disputes:DSP-2026-0012": RESELLER,
  "partner:disputes:DSP-2026-0008": RESELLER,
  "partner:quotes:PQ-2026-0184-v3": RESELLER,
  "partner:quotes:PQ-2026-0171-v1": DISTRIBUTOR,
  "partner:quotes:PQ-2026-0152-v2": REFERRAL,
  "partner:billing:INV-2026-0781": RESELLER,
  "partner:billing:INV-2026-0712": RESELLER,
  "partner:commissions:STM-2026-Q3": RESELLER,
  "partner:commissions:ACC-2026-0712": REFERRAL,
  "partner:renewals:REN-EC-0038": RESELLER,
  "partner:renewals:REN-EC-0041": REFERRAL,
  "partner:sandboxes:SBX-2026-014": RESELLER,
  "partner:sandboxes:POC-2026-021": DISTRIBUTOR,
  "partner:marketplace:AWS-OFFER-1948": RESELLER,
  "partner:marketplace:AZURE-OFFER-0412": DISTRIBUTOR,
  "partner:brand:BRAND-MERIDIAN": RESELLER,
  "partner:brand:DNS-ATLAS": DISTRIBUTOR,
  "partner:support:SUP-18421": RESELLER,
  "partner:support:SUP-18307": DISTRIBUTOR,
};

/** Every customer fixture record that is not named above belongs here. */
export const DEMO_DEFAULT_CUSTOMER_ACCOUNT = DIRECT;
/** Partner records not named above; the resale book is the larger one. */
export const DEMO_DEFAULT_PARTNER_ACCOUNT = RESELLER;

function commercial(input: {
  kind: string;
  id: string;
  title: string;
  description: string;
  status: string;
  statusLabel: string;
  tone: "neutral" | "success" | "warning" | "danger";
  risk: "low" | "medium" | "high";
  owner: string;
  value: string;
  valueLabel: string;
  dateLabel: string;
  term: string;
  nextAction: string;
  allowedActions?: readonly string[];
}): Readonly<Record<string, unknown>> {
  return {
    ...input,
    ...(input.kind === "orders"
      ? { authoritative: { status: input.status } }
      : {}),
    allowedActions: input.allowedActions ?? [],
  };
}

function collection(input: {
  id: string;
  title: string;
  description: string;
  status: "active" | "pending" | "review" | "complete" | "blocked";
  statusLabel: string;
  risk: "low" | "medium" | "high";
  owner: string;
  value: string;
  valueSort: number;
  updatedLabel: string;
  context: readonly { label: string; value: string }[];
}): Readonly<Record<string, unknown>> {
  return { ...input, allowedActions: [] };
}

function partner(input: {
  id: string;
  name: string;
  context: string;
  status: string;
  risk: "low" | "medium" | "high";
  owner: string;
  value: string;
  secondary: string;
}): Readonly<Record<string, unknown>> {
  return { ...input, allowedActions: [] };
}

function record(
  audience: ExperienceAudience,
  channel: ProjectionChannel,
  key: string,
  accountId: string | null,
  data: Readonly<Record<string, unknown>>,
  aggregate?: { readonly type: string; readonly id: string },
): DemoPortalRecord {
  return {
    audience,
    channel,
    key,
    accountId,
    ...(aggregate
      ? { aggregateType: aggregate.type, aggregateId: aggregate.id }
      : {}),
    version: 1,
    updatedAt,
    data,
  };
}

/* --------------------------------------------------------------------------
 * The direct buyer's journey records
 *
 * `demoJourneys` sends Mara Voss to `/quotes/quote-direct-renewal-v2` and Theo
 * Grant to `/billing/invoice-meridian-overdue` and
 * `/billing/invoice-meridian-paid`. Those three routes had no record behind
 * them, so the demo control panel offered three links that landed on "Record
 * unavailable".
 * ----------------------------------------------------------------------- */

const directJourney: readonly DemoPortalRecord[] = [
  record("customer", "quotes", "quote-direct-renewal-v2", DIRECT, {
    ...commercial({
      kind: "quotes",
      id: "quote-direct-renewal-v2",
      title: "Annual renewal · committed capacity",
      description: "400 TB · US East · 12 months · direct renewal",
      status: "open",
      statusLabel: "Issued · awaiting acceptance",
      tone: "warning",
      risk: "medium",
      owner: "Mara Voss",
      value: "$184,800.00",
      valueLabel: "Estimated annual spend",
      dateLabel: "Expires Aug 28",
      term: "Jan 1–Dec 31, 2027 · notice window opens Nov 1",
      nextAction: "Accept before the notice window opens",
      allowedActions: ["accept", "expire"],
    }),
    // These are commercial identity, not projection metadata. The row's
    // `version` remains the materialized projection version; the acceptance
    // ceremony and its paper name the quote number and revision carried by
    // the authoritative quote snapshot instead.
    reference: "Q-2026-0312",
    authoritative: { revision: 2 },
  }),
  record(
    "customer",
    "billing",
    "invoice-meridian-overdue",
    DIRECT,
    commercial({
      kind: "billing",
      id: "invoice-meridian-overdue",
      title: "Committed capacity · overdue",
      description: "Invoice INV-MER-0042 · first ACH attempt was returned",
      status: "open",
      statusLabel: "Overdue · payment retry available",
      tone: "danger",
      risk: "high",
      owner: "Theo Grant",
      value: "$15,400.00",
      valueLabel: "Invoiced net of tax",
      dateLabel: "Due Jul 15 · 16 days overdue",
      term: "Service period Jun 1–30, 2026",
      nextAction: "Retry payment or change the payment method",
    }),
    {
      type: "invoice",
      id: demoUuid("subject:invoice:INV-MER-0042"),
    },
  ),
  record(
    "customer",
    "billing",
    "invoice-meridian-paid",
    DIRECT,
    commercial({
      kind: "billing",
      id: "invoice-meridian-paid",
      title: "Committed capacity · paid",
      description: "Receipt RCT-MER-0038 · ACH ending 1842",
      status: "paid",
      statusLabel: "Paid",
      tone: "success",
      risk: "low",
      owner: "Theo Grant",
      value: "$15,400.00",
      valueLabel: "Invoiced net of tax",
      dateLabel: "Provider confirmed Jun 5",
      term: "Service period May 1–31, 2026",
      nextAction: "Download the receipt",
    }),
  ),
];

/* --------------------------------------------------------------------------
 * The referral end client's book (Lumen Field Research)
 *
 * Nora Chen's journey opens `/services`, and every other customer surface in
 * her navigation needs a record of her own now that the account filter is real.
 * ----------------------------------------------------------------------- */

const endClientBook: readonly DemoPortalRecord[] = [
  record(
    "customer",
    "agreements",
    "AGR-LUMEN-0004",
    END_CLIENT,
    commercial({
      kind: "agreements",
      id: "AGR-LUMEN-0004",
      title: "Cloud Service Agreement",
      description: "Fil One paper · version 2.0 · referred by Northstar",
      status: "active",
      statusLabel: "Active",
      tone: "success",
      risk: "low",
      owner: "Nora Chen",
      value: "Mar 31, 2027",
      valueLabel: "Term end",
      dateLabel: "Updated Jul 12",
      term: "Apr 1, 2026–Mar 31, 2027 · notice opens Feb 1",
      nextAction: "No action due",
    }),
  ),
  record(
    "customer",
    "quotes",
    "Q-LUMEN-0032-v1",
    END_CLIENT,
    commercial({
      kind: "quotes",
      id: "Q-LUMEN-0032-v1",
      title: "POC conversion · field telemetry archive",
      description: "60 TB · US West · annual · referral sourced",
      status: "open",
      statusLabel: "Open",
      tone: "warning",
      risk: "medium",
      owner: "Nora Chen",
      value: "$41,400.00",
      valueLabel: "Estimated annual spend",
      dateLabel: "Expires Aug 12",
      term: "12 months from acceptance",
      nextAction: "Accept or request a revision",
      allowedActions: ["accept", "expire"],
    }),
  ),
  record(
    "customer",
    "orders",
    "ORD-LUMEN-0021",
    END_CLIENT,
    commercial({
      kind: "orders",
      id: "ORD-LUMEN-0021",
      title: "Lumen field archive",
      description: "PO-LF-0221 · 45 TB · US West · referral sourced",
      status: "active",
      statusLabel: "Active",
      tone: "success",
      risk: "low",
      owner: "Service operations",
      value: "$31,050 annual",
      valueLabel: "Committed annual spend",
      dateLabel: "Started Apr 1",
      term: "Apr 1, 2026–Mar 31, 2027 · auto-renews",
      nextAction: "Renewal notice opens Feb 1",
    }),
  ),
  record(
    "customer",
    "services",
    "service-referral-end-client",
    END_CLIENT,
    commercial({
      kind: "services",
      id: "service-referral-end-client",
      title: "Lumen field archive",
      description: "45 TB committed · 28 TB stored · US West",
      status: "active",
      statusLabel: "Active",
      tone: "success",
      risk: "low",
      owner: "Service operations",
      value: "62% used",
      valueLabel: "Capacity usage",
      dateLabel: "Metered 12 min ago",
      term: "Ends Mar 31, 2027",
      nextAction: "No action due",
    }),
  ),
  record(
    "customer",
    "pocs",
    "POC-LUMEN-0009",
    END_CLIENT,
    commercial({
      kind: "pocs",
      id: "POC-LUMEN-0009",
      title: "Field telemetry restore",
      description: "8 TB · three of three success tests passed",
      status: "complete",
      statusLabel: "Complete",
      tone: "success",
      risk: "low",
      owner: "Amina Cole",
      value: "Ready to convert",
      valueLabel: "Outcome",
      dateLabel: "Completed Jul 20",
      term: "Evaluation complete · data retained in place",
      nextAction: "Review the conversion quote",
    }),
  ),
  record(
    "customer",
    "billing",
    "INV-LUMEN-0114",
    END_CLIENT,
    commercial({
      kind: "billing",
      id: "INV-LUMEN-0114",
      title: "July field archive",
      description: "Invoice for the Lumen field archive · PO-LF-0221",
      status: "open",
      statusLabel: "Open",
      tone: "warning",
      risk: "low",
      owner: "Accounts payable",
      value: "$2,587.50",
      valueLabel: "Invoiced amount",
      dateLabel: "Due Aug 12",
      term: "Service period Jul 1–31, 2026",
      nextAction: "Review and pay by Aug 12",
    }),
  ),
  record(
    "customer",
    "amendments",
    "AMD-LUMEN-0003",
    END_CLIENT,
    collection({
      id: "AMD-LUMEN-0003",
      title: "Field archive capacity increase",
      description: "Adds 15 TB to the field archive after the POC conversion.",
      status: "pending",
      statusLabel: "Awaiting customer",
      risk: "low",
      owner: "Nora Chen",
      value: "+$10,350 / year",
      valueSort: 10350,
      updatedLabel: "Updated Jul 29",
      context: [
        { label: "Service", value: "Lumen field archive" },
        { label: "Effective", value: "Sep 1, 2026" },
      ],
    }),
  ),
  record(
    "customer",
    "users",
    "USR-LUMEN-NORA",
    END_CLIENT,
    collection({
      id: "USR-LUMEN-NORA",
      title: "Nora Chen",
      description: "Platform engineer with read access to services and usage.",
      status: "active",
      statusLabel: "Active",
      risk: "low",
      owner: "Nora Chen",
      value: "Member",
      valueSort: 2,
      updatedLabel: "Active today",
      context: [
        { label: "Access", value: "Services and usage" },
        { label: "Security", value: "MFA verified" },
      ],
    }),
  ),
  record(
    "customer",
    "procurement",
    "PROC-LUMEN-AP",
    END_CLIENT,
    collection({
      id: "PROC-LUMEN-AP",
      title: "Accounts payable routing",
      description: "Routes invoices to the verified Lumen billing inbox.",
      status: "active",
      statusLabel: "Verified",
      risk: "low",
      owner: "Nora Chen",
      value: "billing@lumen-field.test",
      valueSort: 5,
      updatedLabel: "Verified Jul 18",
      context: [
        { label: "Invoice delivery", value: "Email and portal" },
        { label: "Purchase order", value: "PO-LF-0221" },
      ],
    }),
  ),
  record(
    "customer",
    "marketplace",
    "AWS-OFFER-LUMEN-0221",
    END_CLIENT,
    collection({
      id: "AWS-OFFER-LUMEN-0221",
      title: "AWS private offer · field archive",
      description: "Provider reports the accepted offer is fulfilled.",
      status: "active",
      statusLabel: "Active",
      risk: "low",
      owner: "Nora Chen",
      value: "$31,050 / year",
      valueSort: 31050,
      updatedLabel: "Provider sync 22 min ago",
      context: [
        { label: "Marketplace", value: "AWS Marketplace" },
        { label: "Billing", value: "AWS is merchant of record" },
      ],
    }),
  ),
  record(
    "customer",
    "support",
    "SUP-LUMEN-19004",
    END_CLIENT,
    collection({
      id: "SUP-LUMEN-19004",
      title: "Restore throughput question",
      description: "Support is reviewing the observed restore throughput.",
      status: "active",
      statusLabel: "In progress",
      risk: "low",
      owner: "Nora Chen",
      value: "Normal priority",
      valueSort: 2,
      updatedLabel: "Provider update 40 min ago",
      context: [
        { label: "Service", value: "Lumen field archive" },
        { label: "Source", value: "Support provider" },
      ],
    }),
  ),
];

/* --------------------------------------------------------------------------
 * Partner records the account filter would otherwise leave empty
 * ----------------------------------------------------------------------- */

const partnerBook: readonly DemoPortalRecord[] = [
  record(
    "partner",
    "quotes",
    "quote-resale-customer-v4",
    RESELLER,
    partner({
      id: "quote-resale-customer-v4",
      name: "Aster House customer quotation",
      context: "Resale · EU West · 120 TB · 12 months",
      status: "draft",
      risk: "medium",
      owner: "Priya Nair",
      value: "£17,250 transfer / £21,400 resale",
      secondary: "Customer price set by Ember Peak · expires Aug 14",
    }),
  ),
  record(
    "partner",
    "quotes",
    "quote-distributor-exception-v1",
    DISTRIBUTOR,
    partner({
      id: "quote-distributor-exception-v1",
      name: "Cobalt Orchard below-floor exception",
      context: "Two-tier · EU West · 80 TB · 12 months",
      status: "pending",
      risk: "high",
      owner: "Elias Ward",
      value: "€31,680 transfer",
      secondary: "Awaiting finance approval · expires Aug 18",
    }),
  ),
  record(
    "partner",
    "disputes",
    "DSP-2026-0021",
    REFERRAL,
    partner({
      id: "DSP-2026-0021",
      name: "Solace attribution claim",
      context: "Registration ownership · referral evidence submitted",
      status: "open",
      risk: "medium",
      owner: "Mira Patel",
      value: "$28,600 at risk",
      secondary: "Response due Aug 6",
    }),
  ),
  record(
    "partner",
    "disputes",
    "DSP-2026-0015",
    DISTRIBUTOR,
    partner({
      id: "DSP-2026-0015",
      name: "Cobalt Orchard provisioning credit",
      context: "Invoice line dispute · provider evidence attached",
      status: "pending",
      risk: "medium",
      owner: "Elias Ward",
      value: "€1,980 disputed",
      secondary: "Fil One reviewing",
    }),
  ),
  record(
    "partner",
    "marketplace",
    "GCP-OFFER-0087",
    REFERRAL,
    partner({
      id: "GCP-OFFER-0087",
      name: "Solace Google Cloud offer",
      context: "Referral · disbursement pending in the provider feed",
      status: "pending",
      risk: "low",
      owner: "Mira Patel",
      value: "$28,600 buyer price",
      secondary: "Google is merchant of record",
    }),
  ),
  record(
    "partner",
    "support",
    "SUP-18512",
    REFERRAL,
    partner({
      id: "SUP-18512",
      name: "Solace usage export",
      context: "Referral-visible summary · standard priority",
      status: "active",
      risk: "low",
      owner: "Fil One support",
      value: "Updated 1 hour ago",
      secondary: "Support system is source",
    }),
  ),
  record(
    "partner",
    "billing",
    "INV-HL-2026-0714",
    DISTRIBUTOR,
    partner({
      id: "INV-HL-2026-0714",
      name: "July consolidated distributor invoice",
      context: "4 end clients · SEPA · Harborline is merchant of record",
      status: "pending",
      risk: "medium",
      owner: "Partner billing",
      value: "€48,220 invoiced",
      secondary: "Due Aug 20 · webhook payment truth",
    }),
  ),
  record(
    "partner",
    "commissions",
    "STM-HL-2026-Q3",
    DISTRIBUTOR,
    partner({
      id: "STM-HL-2026-Q3",
      name: "Q3 distributor statement",
      context: "9 collections · 1 credit · no holdback",
      status: "pending",
      risk: "low",
      owner: "Partner finance",
      value: "€5,786 accrued",
      secondary: "Pays after collection truth settles",
    }),
  ),
  record(
    "partner",
    "renewals",
    "REN-EC-0047",
    DISTRIBUTOR,
    partner({
      id: "REN-EC-0047",
      name: "Cobalt Orchard GmbH",
      context: "Two-tier · 80 TB · current term ends Dec 31",
      status: "attention",
      risk: "medium",
      owner: "Elias Ward",
      value: "€31,680 transfer",
      secondary: "Notice action due Oct 2",
    }),
  ),
];

/* --------------------------------------------------------------------------
 * Internal records
 *
 * Three demo journeys open `/internal/queues/{queue-legal-meridian,
 * queue-price-harborline, queue-provision-cobalt}` and one opens
 * `/internal/accounts/cobalt-orchard`. None of those record keys existed, and
 * the internal `dashboard` channel had no records at all, so the account page
 * and the operator search's Accounts group were both empty.
 * ----------------------------------------------------------------------- */

function internal(
  channel: ProjectionChannel,
  key: string,
  data: Readonly<Record<string, unknown>>,
  aggregate?: { readonly type: string; readonly id: string },
): DemoPortalRecord {
  return record("internal", channel, key, null, data, aggregate);
}

const internalBook: readonly DemoPortalRecord[] = [
  internal("queues", "queue-legal-meridian", {
    title: "Customer paper review · Meridian",
    reference: "queue-legal-meridian",
    description:
      "Meridian's data processing addendum was superseded while the review was open.",
    statusLabel: "Stale version · legal review",
    status: "pending",
    risk: "high",
    owner: "Imani Ross",
    nextAction: "Restore focus to version 2 before deciding",
    authoritative: {
      queue: "legal_review",
      objectType: "agreement_draft",
      targetAt: "2026-08-03T17:00:00.000Z",
    },
    context: [
      { label: "Account", value: "Meridian Archive Labs, Inc." },
      { label: "Document", value: "Data processing addendum v2" },
    ],
    allowedActions: ["review_exception"],
  }),
  internal("queues", "queue-price-harborline", {
    title: "Below-floor pricing decision · Harborline",
    reference: "queue-price-harborline",
    description:
      "The two-tier quote for Cobalt Orchard prices 8.4% below the published floor.",
    statusLabel: "Awaiting finance decision",
    status: "open",
    risk: "high",
    owner: "Mateo Silva",
    nextAction: "Compare the floor variance with the approval policy",
    authoritative: {
      queue: "price_exception",
      objectType: "quote",
      targetAt: "2026-08-01T16:00:00.000Z",
    },
    context: [
      { label: "Partner", value: "Harborline Distribution Ltd" },
      { label: "Annual value", value: "EUR 31,680.00" },
    ],
    allowedActions: ["review_exception"],
  }),
  internal("queues", "queue-provision-cobalt", {
    title: "Provisioning recovery · Cobalt Orchard",
    reference: "queue-provision-cobalt",
    description:
      "The EU West provisioning run failed after the provider accepted the order.",
    statusLabel: "Provider recovery queued",
    status: "blocked",
    risk: "high",
    owner: "Ada Mercer",
    nextAction: "Enter assisted mode and record a retry reason",
    authoritative: {
      queue: "provisioning_recovery",
      objectType: "order",
      targetAt: "2026-07-31T20:00:00.000Z",
    },
    context: [
      { label: "End client", value: "Cobalt Orchard GmbH" },
      { label: "Region", value: "eu-west-2" },
    ],
    allowedActions: ["review_exception"],
  }),
  internal(
    "dashboard",
    "meridian-archive",
    {
      title: "Meridian Archive Labs, Inc.",
      name: "Meridian Archive Labs, Inc.",
      reference: "Meridian Archive Labs, Inc.",
      description: "Direct buyer · US · USD · one overdue invoice",
      statusLabel: "Attention · overdue invoice",
      status: "attention",
      risk: "medium",
      owner: "Ada Mercer",
      nextAction: "Confirm the ACH retry before the renewal notice opens",
      context: [
        { label: "Relationship", value: "Direct" },
        { label: "Annual value", value: "USD 184,800.00" },
      ],
    },
    { type: "account", id: DIRECT },
  ),
  internal(
    "dashboard",
    "cobalt-orchard",
    {
      title: "Cobalt Orchard GmbH",
      name: "Cobalt Orchard GmbH",
      reference: "Cobalt Orchard GmbH",
      description: "Distributor end client · DE · EUR · onboarding",
      statusLabel: "Onboarding · provisioning recovery",
      status: "pending",
      risk: "high",
      owner: "Ada Mercer",
      nextAction: "Verify actual and effective actors on the account timeline",
      context: [
        { label: "Relationship", value: "Two-tier end client" },
        { label: "Distributor", value: "Harborline Distribution Ltd" },
      ],
    },
    { type: "account", id: UK_END_CLIENT },
  ),
  internal(
    "dashboard",
    "ember-peak",
    {
      title: "Ember Peak Systems Ltd",
      name: "Ember Peak Systems Ltd",
      reference: "Ember Peak Systems Ltd",
      description:
        "Reseller · GB · GBP · agreement notice window opens tomorrow",
      statusLabel: "Attention · notice window",
      status: "attention",
      risk: "medium",
      owner: "Ada Mercer",
      nextAction: "Confirm the partner agreement renewal path",
      context: [
        { label: "Relationship", value: "Reseller" },
        { label: "End clients", value: "2 named" },
      ],
    },
    { type: "account", id: RESELLER },
  ),
  internal("agreements", "AGR-2026-0042", {
    title: "Cloud Service Agreement · Meridian",
    name: "Cloud Service Agreement · Meridian",
    description: "Fil One paper · version 3.2 · active",
    statusLabel: "Active",
    status: "active",
    risk: "low",
    owner: "Imani Ross",
    nextAction: "No action due",
    context: [
      { label: "Account", value: "Meridian Archive Labs, Inc." },
      { label: "Term end", value: "Dec 31, 2026" },
    ],
  }),
  internal("quotes", "Q-2026-0184-v3", {
    title: "Enterprise committed capacity · Meridian",
    name: "Enterprise committed capacity · Meridian",
    description: "400 TB · US East · annual · direct",
    statusLabel: "Open",
    status: "open",
    risk: "medium",
    owner: "Mateo Silva",
    nextAction: "Monitor acceptance before expiry",
    context: [
      { label: "Account", value: "Meridian Archive Labs, Inc." },
      { label: "Annual value", value: "USD 184,800.00" },
    ],
  }),
  internal(
    "orders",
    "ORD-2026-0098",
    {
      title: "Northstar primary archive · Meridian",
      name: "Northstar primary archive · Meridian",
      description: "PO-NA-1048 · 500 TB · US East · direct",
      statusLabel: "Active",
      status: "active",
      risk: "low",
      owner: "Ada Mercer",
      nextAction: "Renewal notice opens Nov 1",
      context: [
        { label: "Account", value: "Meridian Archive Labs, Inc." },
        { label: "Service term", value: "Jan 1–Dec 31, 2026" },
      ],
      authoritative: {
        invoicingAccountId: DIRECT,
        sourcing: "direct",
        status: "active",
        serviceStartsOn: "2026-01-01",
        serviceEndsOn: "2026-12-31",
        noticeOn: "2026-11-01",
      },
    },
    { type: "order", id: MERIDIAN_ORDER_ID },
  ),
  internal(
    "collections",
    "INV-2026-0781",
    {
      title: "July committed capacity · Meridian",
      name: "July committed capacity · Meridian",
      reference: "INV-2026-0781",
      description: "Open invoice · gross of determined Washington sales tax",
      statusLabel: "Open · due Aug 8",
      status: "open",
      risk: "medium",
      owner: "Amina Cole",
      dateLabel: "Due Aug 8, 2026",
      nextAction: "Watch for the provider payment webhook",
      context: [{ label: "Account", value: "Meridian Archive Labs, Inc." }],
      authoritative: {
        orderId: MERIDIAN_ORDER_ID,
        status: "open",
        dueAt: "2026-08-08T23:59:59.000Z",
      },
      allowedActions: ["evaluate_dunning"],
    },
    { type: "invoice", id: MERIDIAN_INVOICE_ID },
  ),
  internal(
    "reports",
    "RPT-2026-07",
    {
      title: "Renewal and churn exposure · July 2026",
      reference: "RPT-2026-07",
      description: "Current commerce records at the generation timestamp",
      status: "complete",
      statusLabel: "Complete",
      owner: "Revenue operations",
      authoritative: {
        report: "renewal_churn_exposure",
        documentId: RENEWAL_REPORT_DOCUMENT_ID,
        status: "complete",
      },
      allowedActions: [],
    },
    { type: "report_export", id: RENEWAL_REPORT_ID },
  ),
];

/**
 * The billing rows whose money is the determination engine's answer, not a
 * fixture literal. `projection-source` overlays them on read; nothing here
 * states a tax figure, because a second statement of a tax figure is exactly
 * the drift the shared engine exists to prevent.
 */
export const demoTaxedBillingRecords: readonly string[] = [
  "customer:billing:INV-2026-0781",
  "customer:billing:INV-2026-0712",
  "customer:billing:invoice-meridian-overdue",
  "customer:billing:invoice-meridian-paid",
  "internal:collections:INV-2026-0781",
];

export const demoAdditionalRecords: readonly DemoPortalRecord[] = [
  ...directJourney,
  ...endClientBook,
  ...partnerBook,
  ...internalBook,
];

/* --------------------------------------------------------------------------
 * Orders a prospect created during the demo
 *
 * Everything above is seeded. These are not: they are written by the demo's
 * order-acceptance create pass and read back onto the orders channel, so a
 * prospect who completes the ceremony lands on a record that exists, in the
 * ledger they already know, rather than on a confirmation with nothing behind
 * it. A reset drops them with the rest of the demo state.
 * ----------------------------------------------------------------------- */

/** What the create pass recorded. Written by `DemoOrderAcceptance.create`. */
export interface DemoCreatedOrder {
  readonly id: string;
  readonly domainOrder?: AcceptedOrder;
  readonly organizationId?: string;
  readonly provisioning?: {
    operationId: string;
    submittedAt: string;
    actorId: string;
  };
  readonly quoteRecordKey: string;
  readonly accountId: string;
  readonly audienceAccountId: string;
  readonly orderFormDocumentId: string;
  readonly artifactRequestId: string;
  readonly poNumber: string;
  readonly authorityTitle: string;
  readonly signerName: string;
  readonly serviceStartsOn: string;
  readonly serviceEndsOn: string;
  /** The documentary instant the order form states. */
  readonly acceptedAt: string;
  /** The server's own receive instant, which is what `immutableAt` is. */
  readonly immutableAt: string;
  readonly currency: "USD" | "EUR" | "GBP";
  readonly totalMinor: string;
  readonly agreementReference: string;
  readonly quoteReference: string;
}

/**
 * The record key a created order is addressed by.
 *
 * `record-detail` links a created order as `/orders/order-${id}`, which is the
 * link the acceptance surface already offers on success, so the key carries the
 * same prefix. Nothing else in the demo may claim that shape.
 */
export function demoCreatedOrderKey(orderId: string): string {
  return `order-${orderId}`;
}

/**
 * The created order, as the orders channel serves it.
 *
 * Acceptance establishes the commitment, not a provisioned service. Keep the
 * order pending until a provisioning result exists, including after its planned
 * start date. Every figure comes from the accepted record.
 */
export function demoCreatedOrderRecord(
  order: DemoCreatedOrder,
  /** The reader's formatting locale; this record is built on every read. */
  formatting: string,
): DemoPortalRecord {
  return {
    audience: "customer",
    channel: "orders",
    key: demoCreatedOrderKey(order.id),
    accountId: order.audienceAccountId,
    version: 1,
    updatedAt: order.immutableAt,
    data: {
      ...commercial({
        kind: "orders",
        id: demoCreatedOrderKey(order.id),
        title: `Committed capacity · ${order.poNumber}`,
        description: `Accepted from ${order.quoteReference} · order form on file`,
        status: order.provisioning ? "provisioning" : "pending",
        statusLabel: order.provisioning
          ? "Provisioning · demo request submitted"
          : "Accepted · awaiting provisioning",
        tone: "warning",
        risk: "low",
        owner: order.signerName,
        value: formatMoney(order.totalMinor, order.currency, formatting),
        valueLabel: "Committed spend",
        dateLabel: `Accepted ${order.acceptedAt.slice(0, 10)}`,
        term: `${order.serviceStartsOn} – ${order.serviceEndsOn} · governed by ${order.agreementReference}`,
        nextAction: order.provisioning
          ? "The demo provisioner received this order. Service activation awaits a provider completion result."
          : `Service starts ${order.serviceStartsOn}. Your accepted order is queued for the provisioning team.`,
      }),
      authoritative: {
        status: order.provisioning ? "provisioning" : "accepted",
      },
      // The bound evidence, carried on the record it bound. The seeded rows get
      // theirs from the artifact catalogue's attachment index; this one was not
      // in the catalogue when the process started, so it names its own.
      artifacts: [
        {
          kind: "order_form" as const,
          id: order.artifactRequestId,
          label: `Order form · ${order.poNumber}`,
          state: "stored" as const,
        },
      ],
    },
  };
}
