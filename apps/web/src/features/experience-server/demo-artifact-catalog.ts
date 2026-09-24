// i18n-exempt-file: generated PDF document content (translation policy rule 5: a document's language belongs to the account, not to the reader's interface language). The one UI-facing field, each artifact's `label`, is a message reference rendered for the reader at the demo read boundary.
import { createHash } from "node:crypto";

import {
  ids,
  MinorUnitSchema,
  type TaxDeterminationRequest,
} from "@clockwork/contracts";
import type {
  CommerceDocumentInput,
  DocumentLineItem,
  Party,
} from "@clockwork/documents/model";
import { demoAccountIds } from "@clockwork/testing/personas";

import {
  determineDemoTax,
  determinedTotals,
  formatRatePpm,
  money,
  taxNotes,
  withTaxLabels,
} from "./demo-tax";
import { demoMessage, type DemoMessage } from "./demo-message";
import type { ArtifactKind, ExperienceAudience } from "./model";

/**
 * The paper the demo hands a prospect.
 *
 * Every entry here is fixture data — that is the point of a demo — but nothing
 * downstream of it is. The bytes are produced by `@clockwork/documents`, the
 * one renderer the product ships, from the same `CommerceDocumentInput` shape
 * the authoritative artifact pipeline builds; and every tax figure, treatment,
 * notation and legal basis on those documents comes from the determination
 * engine in `@clockwork/domain/core` running the seeded rule book. A prospect
 * clicking "Download verified PDF" in the demo gets a document produced the way
 * their own documents will be produced.
 *
 * What is deliberately NOT here: a second renderer, a second tax table, or a
 * hand-written `tax: "21%"`. Those are the drift this file exists to avoid.
 */

/** A deterministic identifier shaped like the UUIDs the contract accepts. */
export function demoUuid(seed: string): string {
  const hash = createHash("sha256").update(seed, "utf8").digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

/** `CommerceDocumentInput` before the pipeline stamps its verification block. */
export type DemoDocumentBody = CommerceDocumentInput extends infer Union
  ? Union extends CommerceDocumentInput
    ? Omit<Union, "verification">
    : never
  : never;

export interface DemoArtifactFixture {
  readonly kind: ArtifactKind;
  /** The `/api/experience/artifacts/{kind}/{id}` segment. */
  readonly id: string;
  /**
   * What the delivery list calls the document. The document itself is not
   * translated (rule 5); its name in the interface is, so this is a message
   * the demo read boundary renders in the reader's language.
   */
  readonly label: DemoMessage;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly sourceVersion: string;
  readonly audience: ExperienceAudience;
  /** The audience account. Null only for internal-audience documents. */
  readonly accountId: string | null;
  readonly retainUntil: string;
  readonly createdAt: string;
  /** Projection rows this document hangs off: `audience:channel:recordKey`. */
  readonly attachments: readonly string[];
  readonly document: () => Promise<DemoDocumentBody>;
}

const issuedAt = "2026-07-31T16:00:00.000Z";
const retainUntil = "2033-07-31T16:00:00.000Z";
const taxPointDate = "2026-07-31";

const accounts = demoAccountIds;

/* --------------------------------------------------------------------------
 * Parties
 * ----------------------------------------------------------------------- */

const filOneUs: Party = {
  legalName: "Fil One, Inc.",
  address: {
    line1: "451 Fictional Harbor Way",
    locality: "Wilmington",
    region: "DE",
    postalCode: "19801",
    countryCode: "US",
  },
  taxId: "US-EIN-DEMO-0001",
  contactEmail: "commerce@fil-one-demo.test",
};

const filOneIberia: Party = {
  legalName: "Fil One Iberia, S.L.",
  address: {
    line1: "12 Calle Imaginaria",
    locality: "Madrid",
    postalCode: "28013",
    countryCode: "ES",
  },
  taxId: "ESB1234567X",
  contactEmail: "facturacion@fil-one-demo.test",
};

const meridian: Party = {
  legalName: "Meridian Archive Labs, Inc.",
  address: {
    line1: "1201 Third Avenue",
    line2: "Suite 2200",
    locality: "Seattle",
    region: "WA",
    postalCode: "98104",
    countryCode: "US",
  },
  taxId: "US-EIN-DEMO-4821",
  contactName: "Theo Grant",
  contactEmail: "ap@meridian-archive.test",
};

const emberPeak: Party = {
  legalName: "Ember Peak Systems Ltd",
  address: {
    line1: "18 Imaginary Exchange",
    locality: "London",
    postalCode: "EC2A 1AA",
    countryCode: "GB",
  },
  taxId: "GB123456789",
  contactName: "Priya Nair",
  contactEmail: "accounts@ember-peak.test",
};

const harborline: Party = {
  legalName: "Harborline Distribution Ltd",
  address: {
    line1: "4 Sample Dock Road",
    locality: "Bristol",
    postalCode: "BS1 4ST",
    countryCode: "GB",
  },
  taxId: "GB987654321",
  contactName: "Elias Ward",
  contactEmail: "settlement@harborline-distribution.test",
};

const asterHouse: Party = {
  legalName: "Aster House Media Ltd",
  address: {
    line1: "7 Sample Quay",
    locality: "Bristol",
    postalCode: "BS1 4ST",
    countryCode: "GB",
  },
  taxId: "GB555000111",
  contactEmail: "ops@aster-house.test",
};

const cobaltOrchard: Party = {
  legalName: "Cobalt Orchard GmbH",
  address: {
    line1: "9 Beispielstrasse",
    locality: "Berlin",
    postalCode: "10117",
    countryCode: "DE",
  },
  taxId: "DE123456789",
  contactEmail: "procurement@cobalt-orchard.test",
};

/**
 * The counterparty each demo account is, as one lookup.
 *
 * The parties above were already the recipients on every document the demo
 * renders. Order acceptance needs the same party for the order form it composes
 * from a live acceptance, and taking it from here rather than restating it is
 * what keeps a prospect's own order form addressed identically to the
 * catalogue's.
 */
const demoParties: Readonly<Record<string, Party>> = {
  [accounts.direct]: meridian,
  [accounts.reseller]: emberPeak,
  [accounts.distributor]: harborline,
  [accounts.resaleEndClient]: asterHouse,
  [accounts.ukEndClient]: cobaltOrchard,
};

export function demoPartyFor(accountId: string): Party {
  const party = demoParties[accountId];
  if (!party) throw new Error(`DEMO_PARTY_NOT_FOUND:${accountId}`);
  return party;
}

/**
 * The entity the demo issues as. Every document in the catalogue above already
 * names it; a document composed from a live demo acceptance names the same one,
 * rather than asking the deploy to configure a legal issuer it does not have.
 */
export const demoPlatformIssuer: Party = filOneUs;

/* --------------------------------------------------------------------------
 * Tax profiles
 *
 * These are the two sides of the transaction the determination engine compares.
 * A registration without `verifiedAt` is an unvalidated one, and the engine
 * refuses to carry a reverse charge on it, so the demo states validation dates
 * the way a real record would.
 * ----------------------------------------------------------------------- */

const supplierUs: TaxDeterminationRequest["supplier"] = {
  legalEntityId: "fil-one-inc",
  establishedCountry: "US",
  registrations: [
    {
      jurisdiction: "US",
      scheme: "us-sales-tax",
      number: "601-000-000",
      verifiedAt: "2026-01-05T00:00:00.000Z",
      evidenceReference: "demo-evidence:supplier-registration:us",
    },
  ],
};

const supplierEs: TaxDeterminationRequest["supplier"] = {
  legalEntityId: "fil-one-iberia-sl",
  establishedCountry: "ES",
  registrations: [
    {
      jurisdiction: "ES",
      scheme: "eu-vat",
      number: "ESB1234567X",
      verifiedAt: "2026-06-01T00:00:00.000Z",
      evidenceReference: "demo-evidence:supplier-registration:es",
    },
  ],
};

const supplierGbReseller: TaxDeterminationRequest["supplier"] = {
  legalEntityId: "ember-peak-systems-ltd",
  establishedCountry: "GB",
  registrations: [
    {
      jurisdiction: "GB",
      scheme: "gb-vat",
      number: "GB123456789",
      verifiedAt: "2026-01-10T00:00:00.000Z",
      evidenceReference: "demo-evidence:supplier-registration:gb",
    },
  ],
};

const customerMeridian: TaxDeterminationRequest["customer"] = {
  accountId: ids.account.parse(accounts.direct),
  country: "US",
  address: { country: "US", region: "WA", postalCode: "98104" },
  status: "business",
  registrations: [],
  exemptionCertificates: [],
};

const customerEmberPeak: TaxDeterminationRequest["customer"] = {
  accountId: ids.account.parse(accounts.reseller),
  country: "GB",
  address: { country: "GB", postalCode: "EC2A 1AA" },
  status: "business",
  registrations: [
    {
      jurisdiction: "GB",
      scheme: "gb-vat",
      number: "GB123456789",
      verifiedAt: "2026-05-02T00:00:00.000Z",
      evidenceReference: "demo-evidence:customer-registration:ember-peak",
    },
  ],
  exemptionCertificates: [],
};

const customerAsterHouse: TaxDeterminationRequest["customer"] = {
  accountId: ids.account.parse(accounts.resaleEndClient),
  country: "GB",
  address: { country: "GB", postalCode: "BS1 4ST" },
  status: "business",
  registrations: [
    {
      jurisdiction: "GB",
      scheme: "gb-vat",
      number: "GB555000111",
      verifiedAt: "2026-05-02T00:00:00.000Z",
      evidenceReference: "demo-evidence:customer-registration:aster-house",
    },
  ],
  exemptionCertificates: [],
};

const customerCobaltOrchard: TaxDeterminationRequest["customer"] = {
  accountId: ids.account.parse(accounts.ukEndClient),
  country: "DE",
  address: { country: "DE", postalCode: "10117" },
  status: "business",
  registrations: [
    {
      jurisdiction: "DE",
      scheme: "eu-vat",
      number: "DE123456789",
      verifiedAt: "2026-06-15T00:00:00.000Z",
      evidenceReference: "demo-evidence:customer-registration:cobalt-orchard",
    },
  ],
  exemptionCertificates: [],
};

/* --------------------------------------------------------------------------
 * Line item sets
 * ----------------------------------------------------------------------- */

function line(
  id: string,
  description: string,
  detail: string,
  quantity: string,
  unitLabel: string,
  currency: "USD" | "EUR" | "GBP",
  unitPriceMinor: string,
  amountMinor: string,
): DocumentLineItem {
  return {
    id,
    description,
    detail,
    quantity,
    unitLabel,
    unitPrice: money(currency, unitPriceMinor),
    amount: money(currency, amountMinor),
  };
}

/**
 * The annual committed-capacity offer, $184,800.00 net.
 *
 * 400 × $420.00 = $168,000.00, plus $16,800.00 of enhanced support, which is
 * the `$184,800.00` the quote and order surfaces already show.
 */
export const annualCapacityLines: readonly DocumentLineItem[] = [
  line(
    "line-capacity",
    "Committed archive capacity — 400 TB · US East",
    "Term drawdown with contracted overage pricing above the commitment",
    "400",
    "TB-year",
    "USD",
    "42000",
    "16800000",
  ),
  line(
    "line-support",
    "Enhanced response schedule",
    "24×7 severity-1 response across both regions",
    "1",
    "annual",
    "USD",
    "1680000",
    "1680000",
  ),
];

/** One monthly invoice, $15,400.00 net: $12,320.00 committed plus overage. */
const monthlyInvoiceLines: readonly DocumentLineItem[] = [
  line(
    "line-capacity",
    "Committed archive capacity — July 2026",
    "Monthly drawdown against the annual commitment",
    "400",
    "TB-month",
    "USD",
    "3080",
    "1232000",
  ),
  line(
    "line-overage",
    "Metered overage — 100 TB",
    "Reconciled from provider metering at the contracted overage rate",
    "100",
    "TB-month",
    "USD",
    "3080",
    "308000",
  ),
];

/** Transfer price to the reseller, £17,250.00 net. */
const transferLines: readonly DocumentLineItem[] = [
  line(
    "line-transfer",
    "Committed archive capacity — 120 TB · EU West",
    "Partner transfer price; confidential partner commercial information",
    "120",
    "TB-year",
    "GBP",
    "14375",
    "1725000",
  ),
];

/** Reseller's customer-priced offer to its end client, £21,400.00 net. */
const resaleLines: readonly DocumentLineItem[] = [
  line(
    "line-resale",
    "Committed archive capacity — 120 TB · EU West",
    "Issued by Ember Peak Systems Ltd as merchant of record",
    "120",
    "TB-year",
    "GBP",
    "17833",
    "2140000",
  ),
];

/** Distributor's two-tier offer for its German end client, €31,680.00 net. */
const distributorLines: readonly DocumentLineItem[] = [
  line(
    "line-eu-capacity",
    "Committed archive capacity — 80 TB · EU West",
    "Two-tier distribution to Cobalt Orchard GmbH",
    "80",
    "TB-year",
    "EUR",
    "39600",
    "3168000",
  ),
];

/* --------------------------------------------------------------------------
 * Determination requests
 * ----------------------------------------------------------------------- */

function determinationFor(
  supplier: TaxDeterminationRequest["supplier"],
  customer: TaxDeterminationRequest["customer"],
  lines: readonly DocumentLineItem[],
  documentType: TaxDeterminationRequest["documentType"],
) {
  return determineDemoTax({
    supplier,
    customer,
    lines: lines.map((item) => ({
      lineId: item.id,
      taxCode: "txcd_10000000",
      supplyType: "service",
      netAmount: {
        currency: item.amount.currency,
        minor: MinorUnitSchema.parse(item.amount.minorUnits),
      },
    })),
    taxPointDate,
    documentType,
  });
}

function base(
  kind: ArtifactKind,
  documentId: string,
  version: string,
  issuer: Party,
  recipient: Party,
  locale: "en-US" | "en-GB" | "en-IE" | "es-ES",
) {
  return { kind, documentId, version, issuedAt, locale, issuer, recipient };
}

const period = { startDate: "2026-01-01", endDate: "2026-12-31" } as const;
const nextPeriod = { startDate: "2027-01-01", endDate: "2027-12-31" } as const;

/* --------------------------------------------------------------------------
 * The catalog
 * ----------------------------------------------------------------------- */

function fixture(
  input: Omit<DemoArtifactFixture, "id" | "retainUntil" | "createdAt">,
): DemoArtifactFixture {
  return {
    ...input,
    id: demoUuid(`artifact:${input.kind}:${input.subjectId}`),
    retainUntil,
    createdAt: issuedAt,
  };
}

function subject(type: string, reference: string): string {
  return demoUuid(`subject:${type}:${reference}`);
}

async function directQuote(
  documentId: string,
  version: string,
  quoteNumber: string,
  validUntil: string,
): Promise<DemoDocumentBody> {
  const tax = await determinationFor(
    supplierUs,
    customerMeridian,
    annualCapacityLines,
    // A quote is not a tax document; `proforma` is the determination type the
    // contract offers for a priced document that raises no liability yet.
    "proforma",
  );
  return {
    ...base("direct_quote", documentId, version, filOneUs, meridian, "en-US"),
    kind: "direct_quote",
    quoteNumber,
    validUntil,
    currency: "USD",
    lineItems: withTaxLabels(annualCapacityLines, tax),
    totals: determinedTotals(tax),
    servicePeriod: period,
    agreementReference: "AGR-2026-0042 · Cloud Service Agreement v3.2",
    purchaseOrderRequired: true,
    paymentTerms: "Annual prepayment · ACH",
    commercialTerms: [
      "Usage above the committed capacity is billed monthly in arrears at the contracted overage rate shown on each line.",
      "Prices hold through the validity date. Taxes are shown as determined at the tax point stated below.",
      "The accepted quote version and the governing agreement version are pinned onto the resulting order.",
    ],
    notes: taxNotes(tax),
  };
}

async function orderForm(): Promise<DemoDocumentBody> {
  const tax = await determinationFor(
    supplierUs,
    customerMeridian,
    annualCapacityLines,
    "invoice",
  );
  return {
    ...base("order_form", "ORD-2026-0098", "4", filOneUs, meridian, "en-US"),
    kind: "order_form",
    orderNumber: "ORD-2026-0098",
    quoteReference: "Q-2026-0184-v3",
    governingAgreementReference: "AGR-2026-0042 · Cloud Service Agreement v3.2",
    purchaseOrderNumber: "PO-NA-1048",
    servicePeriod: period,
    currency: "USD",
    lineItems: withTaxLabels(annualCapacityLines, tax),
    totals: determinedTotals(tax),
    paymentTerms: "Annual prepayment · ACH · net 30",
    signer: {
      name: "Mara Voss",
      title: "Operations Director",
      acceptedAt: "2026-01-01T09:12:00.000Z",
      authorityAttestation:
        "I am authorized to bind Meridian Archive Labs, Inc. to this order form.",
    },
    notes: taxNotes(tax),
  };
}

async function amendment(): Promise<DemoDocumentBody> {
  const deltaLines = [
    {
      ...line(
        "delta-capacity",
        "Madrid compliance replica — additional 40 TB",
        "Co-terminated with the existing service period",
        "40",
        "TB-year",
        "USD",
        "26400",
        "1056000",
      ),
      change: "add" as const,
    },
  ];
  const tax = await determinationFor(
    supplierUs,
    customerMeridian,
    deltaLines,
    "invoice",
  );
  return {
    ...base("amendment", "AMD-2026-0028", "2", filOneUs, meridian, "en-US"),
    kind: "amendment",
    amendmentNumber: "AMD-2026-0028",
    parentOrderReference: "ORD-2026-0112",
    governingAgreementReference: "AGR-2026-0042 · Cloud Service Agreement v3.2",
    effectiveDate: "2026-08-15",
    prorationMethod: "Daily actual / 365, co-terminated with the parent order",
    // `withTaxLabels` maps one output per input in order, so the change verb is
    // read back from the line with the matching id rather than by position —
    // an index default would quietly relabel a `remove` as an `add`.
    deltaLines: withTaxLabels(deltaLines, tax).map((item) => {
      const source = deltaLines.find((line) => line.id === item.id);
      if (!source)
        throw new Error(`Amendment delta line ${item.id} is missing`);
      return { ...item, change: source.change };
    }),
    netChange: money("USD", "1056000"),
    resultingTerm: period,
    notes: taxNotes(tax),
  };
}

async function invoice(
  kind: "invoice_companion" | "receipt",
  documentId: string,
  invoiceNumber: string,
  detail: {
    dueDate: string;
    paidAt?: string;
    paymentReference?: string;
    paymentMethod?: string;
  },
): Promise<DemoDocumentBody> {
  const tax = await determinationFor(
    supplierUs,
    customerMeridian,
    monthlyInvoiceLines,
    // A receipt evidences payment of an invoice; it is not a credit note, and
    // saying so would pin the wrong document type onto the determination id.
    "invoice",
  );
  const totals = determinedTotals(tax);
  const paid = kind === "receipt";
  return {
    ...base(kind, documentId, "3", filOneUs, meridian, "en-US"),
    kind,
    invoiceNumber,
    orderReference: "ORD-2026-0098",
    purchaseOrderNumber: "PO-NA-1048",
    dueDate: detail.dueDate,
    ...(detail.paidAt ? { paidAt: detail.paidAt } : {}),
    ...(detail.paymentReference
      ? { paymentReference: detail.paymentReference }
      : {}),
    ...(detail.paymentMethod ? { paymentMethod: detail.paymentMethod } : {}),
    currency: "USD",
    lineItems: withTaxLabels(monthlyInvoiceLines, tax),
    totals,
    amountPaid: money("USD", paid ? totals.total.minorUnits : "0"),
    balanceDue: money("USD", paid ? "0" : totals.total.minorUnits),
    notes: taxNotes(tax),
  };
}

function poc(
  kind: "poc_summary" | "poc_final_report",
  documentId: string,
  pocNumber: string,
): DemoDocumentBody {
  const final = kind === "poc_final_report";
  return {
    ...base(kind, documentId, final ? "4" : "2", filOneUs, meridian, "en-US"),
    kind,
    pocNumber,
    workload: final
      ? "Immutable legal records retained under Object Lock"
      : "Telemetry archive recovery at production scale",
    permittedDataClass:
      "Encrypted business archive; no regulated health or payment data",
    status: final ? "Complete" : "Active",
    ownerName: "Amina Cole",
    servicePeriod: final
      ? { startDate: "2026-06-15", endDate: "2026-07-27" }
      : { startDate: "2026-07-08", endDate: "2026-08-07" },
    capacityCap: final ? "12 TB stored" : "20 TB stored",
    egressCap: final ? "3 TB during the evaluation" : "5 TB during the POC",
    successTests: [
      {
        id: "test-ingest",
        label: "Sustain the agreed ingest throughput",
        target: ">= 15 Gbps",
        observed: "18.4 Gbps",
        result: "passed",
      },
      {
        id: "test-restore",
        label: "Restore a representative archive sample",
        target: "100% checksum match",
        ...(final ? { observed: "100% verified" } : {}),
        result: final ? ("passed" as const) : ("pending" as const),
      },
      {
        id: "test-retention",
        label: "Validate retention-policy behaviour",
        target: "No early-delete path",
        observed: "Policy verified in the isolated tenant",
        result: "passed",
      },
      {
        id: "test-egress",
        label: "Meter and cap evaluation egress",
        target: "Hard cap enforced",
        ...(final ? { observed: "Cap enforced at 3 TB" } : {}),
        result: final ? ("passed" as const) : ("pending" as const),
      },
    ],
    metrics: [
      {
        id: "metric-throughput",
        label: "Ingest throughput",
        value: "18.4 Gbps",
        context: "daily peak",
      },
      {
        id: "metric-integrity",
        label: "Integrity checks",
        value: "100% passed",
        context: "sampled retrievals",
      },
    ],
    outcome: final
      ? "All four agreed success tests passed. The isolated tenant remains available for in-place conversion."
      : "Two of four success tests have passed; the restore exercise is scheduled before expiry.",
    recommendation: final
      ? "Convert the existing tenant to the annual committed offer without moving stored data."
      : "Complete the restore validation, then price the production commitment range.",
  };
}

function renewal(
  kind: "renewal_confirmation" | "decline_confirmation",
): DemoDocumentBody {
  const declined = kind === "decline_confirmation";
  return {
    ...base(
      kind,
      declined ? "DEC-2026-0112" : "REN-2026-0098",
      "1",
      filOneUs,
      meridian,
      "en-US",
    ),
    kind,
    confirmationNumber: declined ? "DEC-2026-0112" : "REN-2026-0098",
    orderReference: declined ? "ORD-2026-0112" : "ORD-2026-0098",
    agreementReference: "AGR-2026-0042 · Cloud Service Agreement v3.2",
    currentTerm: period,
    ...(declined ? { noticeServedOn: "2026-07-30" } : { nextTerm: nextPeriod }),
    effectiveDate: declined ? "2026-12-31" : "2027-01-01",
    renewalType: declined ? ("expires" as const) : ("manual" as const),
    recordedBy: "Mara Voss, Operations Director",
    confirmationText: declined
      ? "A non-renewal notice has been recorded for the referenced order. Service remains available through the current term end date, after which offboarding begins."
      : "Renewal has been confirmed for the next service term under the referenced agreement and the accepted quote version.",
  };
}

function deletionCertificate(): DemoDocumentBody {
  return {
    ...base(
      "deletion_certificate",
      "DEL-2026-0008",
      "1",
      filOneUs,
      meridian,
      "en-US",
    ),
    kind: "deletion_certificate",
    certificateNumber: "DEL-2026-0008",
    accountReference: "Meridian Archive Labs, Inc.",
    orderReference: "ORD-2026-0112",
    deletionScope: [
      "Application credentials and active access grants",
      "Mutable archive objects outside active retention",
      "Temporary indexes, caches, and derived metadata",
    ],
    deletionMethod:
      "Cryptographic erasure followed by provider deletion confirmation",
    completedAt: "2026-07-31T15:55:00.000Z",
    orchestratorConfirmation: "ORCH-DELETE-DEMO-1188:CONF-88213",
    retentionExclusions: [
      {
        id: "retention-object-lock",
        scope: "Archive vault eu-demo-07 · 18.4 TB",
        reason: "Active Object Lock compliance retention",
        retentionExpiresOn: "2027-11-14",
      },
      {
        id: "retention-contract-evidence",
        scope: "Executed agreements and acceptance evidence",
        reason: "Contract evidence retention",
        retentionExpiresOn: "2033-07-31",
      },
    ],
    approvedBy: [
      {
        name: "Ada Mercer",
        role: "Commerce operations approver",
        approvedAt: "2026-07-31T15:40:00.000Z",
      },
      {
        name: "Imani Ross",
        role: "Legal approver",
        approvedAt: "2026-07-31T15:44:00.000Z",
      },
    ],
  };
}

async function partnerTransferQuote(): Promise<DemoDocumentBody> {
  const tax = await determinationFor(
    supplierEs,
    customerEmberPeak,
    transferLines,
    "proforma",
  );
  return {
    ...base(
      "partner_transfer_quote",
      "PQ-2026-0184-v3",
      "3",
      filOneIberia,
      emberPeak,
      "en-GB",
    ),
    kind: "partner_transfer_quote",
    quoteNumber: "PQ-2026-0184-v3",
    validUntil: "2026-08-21",
    currency: "GBP",
    lineItems: withTaxLabels(transferLines, tax),
    totals: determinedTotals(tax),
    servicePeriod: period,
    agreementReference: "PARTNER-RESALE-2026-02",
    paymentTerms: "Net 30 days · BACS",
    endClient: asterHouse,
    commercialTerms: [
      "Transfer prices are confidential partner commercial information and must not be shown to the end client.",
      "The partner is merchant of record to the named end client.",
    ],
    notes: taxNotes(tax),
  };
}

async function partnerResaleQuote(): Promise<DemoDocumentBody> {
  const tax = await determinationFor(
    supplierGbReseller,
    customerAsterHouse,
    resaleLines,
    "proforma",
  );
  return {
    ...base(
      "partner_resale_quote",
      "EP-QT-9007",
      "4",
      emberPeak,
      asterHouse,
      "en-GB",
    ),
    kind: "partner_resale_quote",
    brand: {
      wordmark: "EMBER PEAK",
      legalName: emberPeak.legalName,
      accentColor: "#334D68",
      supportEmail: "support@ember-peak.test",
      legalFooter: "Ember Peak Systems Ltd customer quotation",
    },
    quoteNumber: "EP-QT-9007",
    validUntil: "2026-08-14",
    currency: "GBP",
    lineItems: withTaxLabels(resaleLines, tax),
    totals: determinedTotals(tax),
    servicePeriod: period,
    paymentTerms: "Annual prepayment · BACS",
    commercialTerms: [
      "This customer quotation is issued by Ember Peak Systems Ltd.",
      "Questions about pricing, payment, or renewal go to Ember Peak.",
    ],
    notes: taxNotes(tax),
  };
}

async function distributorQuote(): Promise<DemoDocumentBody> {
  const tax = await determinationFor(
    supplierEs,
    customerCobaltOrchard,
    distributorLines,
    "proforma",
  );
  return {
    ...base(
      "partner_transfer_quote",
      "PQ-2026-0152-v2",
      "2",
      filOneIberia,
      harborline,
      "en-GB",
    ),
    kind: "partner_transfer_quote",
    quoteNumber: "PQ-2026-0152-v2",
    validUntil: "2026-08-18",
    currency: "EUR",
    lineItems: withTaxLabels(distributorLines, tax),
    totals: determinedTotals(tax),
    servicePeriod: period,
    agreementReference: "PARTNER-DISTRIBUTION-2026-01",
    paymentTerms: "Net 45 days · SEPA",
    endClient: cobaltOrchard,
    commercialTerms: [
      "Below-floor pricing on this version is held for finance approval before issue.",
      "The German end client accounts for the tax shown as reverse charged.",
    ],
    notes: taxNotes(tax),
  };
}

function commissionStatement(): DemoDocumentBody {
  const lines = Array.from({ length: 6 }, (_, index) => ({
    id: `commission-${index + 1}`,
    endClientName: `Ember Peak portfolio client ${index + 1}`,
    invoiceReference: `INV-EP-${String(index + 1).padStart(4, "0")}`,
    collectedRevenue: money("GBP", String(63_000 + index * 2_000)),
    commissionRateBasisPoints: 1200,
    earned: money("GBP", String(7_560 + index * 240)),
    ...(index === 3
      ? {
          adjustment: money("GBP", "-8400"),
          adjustmentReason: "Credit note CN-204 applied",
        }
      : {}),
  }));
  // 6 lines at 12%: 7,560 + 7,800 + 8,040 + 8,280 + 8,520 + 8,760 = 48,960.
  return {
    ...base(
      "commission_statement",
      "STM-2026-Q3",
      "1",
      filOneUs,
      emberPeak,
      "en-GB",
    ),
    kind: "commission_statement",
    statementNumber: "STM-2026-Q3",
    period: { startDate: "2026-07-01", endDate: "2026-09-30" },
    lines,
    grossCommission: money("GBP", "48960"),
    clawbacks: money("GBP", "-8400"),
    holdback: money("GBP", "-4000"),
    netPayable: money("GBP", "36560"),
    paymentStatus: "Approved for payment",
  };
}

function reconciliationReport(): DemoDocumentBody {
  return {
    ...base(
      "reconciliation_report",
      "REC-2026-07",
      "1",
      filOneUs,
      filOneUs,
      "en-US",
    ),
    kind: "reconciliation_report",
    reportTitle: "Monthly three-way reconciliation",
    period: { startDate: "2026-07-01", endDate: "2026-07-31" },
    generatedAt: issuedAt,
    basis: "Commerce ledger compared with the payment and accounting ledgers",
    status: "Review complete · two explained timing items",
    columns: [
      { key: "measure", label: "Measure" },
      { key: "platform", label: "Platform", align: "right" },
      { key: "external", label: "External", align: "right" },
      { key: "variance", label: "Variance", align: "right" },
    ],
    // The two demo invoices for this account, each $15,400.00 net with
    // $1,732.50 of determined Washington sales tax: net 30,800.00 plus tax
    // 3,465.00 is the 34,265.00 gross below.
    rows: [
      {
        id: "net",
        values: {
          measure: "Invoiced net of tax",
          platform: "USD 30,800.00",
          external: "USD 30,800.00",
          variance: "USD 0.00",
        },
      },
      {
        id: "tax",
        values: {
          measure: "Tax determined",
          platform: "USD 3,465.00",
          external: "USD 3,465.00",
          variance: "USD 0.00",
        },
      },
      {
        id: "gross",
        values: {
          measure: "Gross invoiced",
          platform: "USD 34,265.00",
          external: "USD 34,265.00",
          variance: "USD 0.00",
        },
        emphasis: "total",
      },
    ],
    summary: [
      { id: "variance", label: "Unexplained variance", value: "USD 0.00" },
      {
        id: "exceptions",
        label: "Exceptions",
        value: "2",
        detail: "both explained by settlement timing",
      },
    ],
    exceptions: [
      "INV-2026-0781 is pending settlement timing confirmation.",
      "The accounting journal batch DEMO-07 remains in sandbox review.",
    ],
  };
}

function reportExport(): DemoDocumentBody {
  return {
    ...base("report_export", "RPT-2026-07", "1", filOneUs, filOneUs, "en-US"),
    kind: "report_export",
    reportTitle: "Renewal and churn exposure",
    period: { startDate: "2026-07-01", endDate: "2026-07-31" },
    generatedAt: issuedAt,
    basis: "Current commerce records at the generation timestamp",
    status: "complete",
    columns: [
      { key: "account", label: "Account", width: 28 },
      { key: "order", label: "Order", width: 20 },
      { key: "term_end", label: "Term end", width: 16 },
      {
        key: "annual_value",
        label: "Annual value (net)",
        align: "right",
        width: 20,
      },
      { key: "state", label: "State", width: 16 },
    ],
    rows: [
      {
        id: "row-meridian",
        values: {
          account: "Meridian Archive Labs, Inc.",
          order: "ORD-2026-0098",
          term_end: "2026-12-31",
          annual_value: "USD 184,800.00",
          state: "Notice window opens Nov 1",
        },
        emphasis: "warning",
      },
      {
        id: "row-ember-peak",
        values: {
          account: "Ember Peak Systems Ltd",
          order: "ORD-EP-2026-0041",
          term_end: "2026-12-31",
          annual_value: "GBP 17,250.00",
          state: "Auto-renews",
        },
      },
      {
        id: "row-cobalt",
        values: {
          account: "Cobalt Orchard GmbH",
          order: "ORD-HL-2026-0009",
          term_end: "2026-12-31",
          annual_value: "EUR 31,680.00",
          state: "Provisioning recovery",
        },
      },
    ],
    summary: [
      { id: "rows", label: "Rows", value: "3" },
      { id: "at-risk", label: "At risk", value: "1", detail: "notice due" },
    ],
  };
}

/**
 * Every document kind the artifact pipeline can produce, bound to the demo
 * records a prospect can open. The count is asserted below: a kind that gains a
 * renderer without gaining a demo document is a capability the demo cannot
 * show, which is the failure this catalog exists to prevent.
 */
export const demoArtifactCatalog: readonly DemoArtifactFixture[] = [
  fixture({
    kind: "direct_quote",
    label: demoMessage("experience.data.artifact.quote", {
      reference: "Q-2026-0184-v3",
    }),
    subjectType: "quote",
    subjectId: subject("quote", "Q-2026-0184-v3"),
    sourceVersion: "3",
    audience: "customer",
    accountId: accounts.direct,
    attachments: ["customer:quotes:Q-2026-0184-v3"],
    document: () =>
      directQuote("Q-2026-0184-v3", "3", "Q-2026-0184-v3", "2026-08-04"),
  }),
  fixture({
    kind: "direct_quote",
    label: demoMessage("experience.data.artifact.renewalQuote", {
      reference: "QT-RENEWAL-0002",
    }),
    subjectType: "quote",
    subjectId: subject("quote", "quote-direct-renewal-v2"),
    sourceVersion: "2",
    audience: "customer",
    accountId: accounts.direct,
    attachments: ["customer:quotes:quote-direct-renewal-v2"],
    document: () =>
      directQuote("QT-RENEWAL-0002", "2", "QT-RENEWAL-0002", "2026-08-28"),
  }),
  fixture({
    kind: "order_form",
    label: demoMessage("experience.data.artifact.orderForm", {
      reference: "ORD-2026-0098",
    }),
    subjectType: "order",
    subjectId: subject("order", "ORD-2026-0098"),
    sourceVersion: "4",
    audience: "customer",
    accountId: accounts.direct,
    attachments: ["customer:orders:ORD-2026-0098"],
    document: orderForm,
  }),
  fixture({
    kind: "amendment",
    label: demoMessage("experience.data.artifact.amendment", {
      reference: "AMD-2026-0028",
    }),
    subjectType: "amendment",
    subjectId: subject("amendment", "AMD-2026-0028"),
    sourceVersion: "2",
    audience: "customer",
    accountId: accounts.direct,
    attachments: [
      "customer:amendments:AMD-2026-0028",
      "customer:orders:ORD-2026-0112",
    ],
    document: amendment,
  }),
  fixture({
    kind: "invoice_companion",
    label: demoMessage("experience.data.artifact.invoice", {
      reference: "INV-2026-0781",
    }),
    subjectType: "invoice",
    subjectId: subject("invoice", "INV-2026-0781"),
    sourceVersion: "3",
    audience: "customer",
    accountId: accounts.direct,
    attachments: ["customer:billing:INV-2026-0781"],
    document: () =>
      invoice("invoice_companion", "INV-2026-0781", "INV-2026-0781", {
        dueDate: "2026-08-08",
      }),
  }),
  fixture({
    kind: "invoice_companion",
    label: demoMessage("experience.data.artifact.invoiceOverdue", {
      reference: "INV-MER-0042",
    }),
    subjectType: "invoice",
    subjectId: subject("invoice", "invoice-meridian-overdue"),
    sourceVersion: "3",
    audience: "customer",
    accountId: accounts.direct,
    attachments: ["customer:billing:invoice-meridian-overdue"],
    document: () =>
      invoice("invoice_companion", "INV-MER-0042", "INV-MER-0042", {
        dueDate: "2026-07-15",
      }),
  }),
  fixture({
    kind: "receipt",
    label: demoMessage("experience.data.artifact.receipt", {
      reference: "RCT-2026-0712",
    }),
    subjectType: "invoice",
    subjectId: subject("invoice", "INV-2026-0712"),
    sourceVersion: "3",
    audience: "customer",
    accountId: accounts.direct,
    attachments: ["customer:billing:INV-2026-0712"],
    document: () =>
      invoice("receipt", "RCT-2026-0712", "INV-2026-0712", {
        dueDate: "2026-07-08",
        paidAt: "2026-07-03T16:25:00.000Z",
        paymentReference: "ACH-1842-20260703",
        paymentMethod: "ACH bank transfer",
      }),
  }),
  fixture({
    kind: "receipt",
    label: demoMessage("experience.data.artifact.receipt", {
      reference: "RCT-MER-0038",
    }),
    subjectType: "invoice",
    subjectId: subject("invoice", "invoice-meridian-paid"),
    sourceVersion: "3",
    audience: "customer",
    accountId: accounts.direct,
    attachments: ["customer:billing:invoice-meridian-paid"],
    document: () =>
      invoice("receipt", "RCT-MER-0038", "INV-MER-0038", {
        dueDate: "2026-06-08",
        paidAt: "2026-06-05T10:02:00.000Z",
        paymentReference: "ACH-1842-20260605",
        paymentMethod: "ACH bank transfer",
      }),
  }),
  fixture({
    kind: "poc_summary",
    label: demoMessage("experience.data.artifact.pocSummary", {
      reference: "POC-2026-0031",
    }),
    subjectType: "poc",
    subjectId: subject("poc", "POC-2026-0031"),
    sourceVersion: "2",
    audience: "customer",
    accountId: accounts.direct,
    attachments: ["customer:pocs:POC-2026-0031"],
    document: () =>
      Promise.resolve(poc("poc_summary", "POC-2026-0031-S", "POC-2026-0031")),
  }),
  fixture({
    kind: "poc_final_report",
    label: demoMessage("experience.data.artifact.pocFinalReport", {
      reference: "POC-2026-0024",
    }),
    subjectType: "poc",
    subjectId: subject("poc", "POC-2026-0024"),
    sourceVersion: "4",
    audience: "customer",
    accountId: accounts.direct,
    attachments: ["customer:pocs:POC-2026-0024"],
    document: () =>
      Promise.resolve(
        poc("poc_final_report", "POC-2026-0024-F", "POC-2026-0024"),
      ),
  }),
  fixture({
    kind: "renewal_confirmation",
    label: demoMessage("experience.data.artifact.renewalConfirmation", {
      reference: "REN-2026-0098",
    }),
    subjectType: "renewal_action",
    subjectId: subject("renewal_action", "REN-2026-0098"),
    sourceVersion: "1",
    audience: "customer",
    accountId: accounts.direct,
    attachments: [
      "customer:orders:ORD-2026-0098",
      "customer:services:SVC-PRIMARY-01",
    ],
    document: () => Promise.resolve(renewal("renewal_confirmation")),
  }),
  fixture({
    kind: "decline_confirmation",
    label: demoMessage("experience.data.artifact.nonRenewalNotice", {
      reference: "DEC-2026-0112",
    }),
    subjectType: "renewal_action",
    subjectId: subject("renewal_action", "DEC-2026-0112"),
    sourceVersion: "1",
    audience: "customer",
    accountId: accounts.direct,
    attachments: ["customer:services:SVC-REPLICA-02"],
    document: () => Promise.resolve(renewal("decline_confirmation")),
  }),
  fixture({
    kind: "deletion_certificate",
    label: demoMessage("experience.data.artifact.deletionCertificate", {
      reference: "DEL-2026-0008",
    }),
    subjectType: "deletion_certificate",
    subjectId: subject("deletion_certificate", "DEL-2026-0008"),
    sourceVersion: "1",
    audience: "customer",
    accountId: accounts.direct,
    attachments: ["customer:services:SVC-REPLICA-02"],
    document: () => Promise.resolve(deletionCertificate()),
  }),
  fixture({
    kind: "partner_transfer_quote",
    label: demoMessage("experience.data.artifact.transferQuote", {
      reference: "PQ-2026-0184-v3",
    }),
    subjectType: "quote",
    subjectId: subject("quote", "PQ-2026-0184-v3"),
    sourceVersion: "3",
    audience: "partner",
    accountId: accounts.reseller,
    attachments: ["partner:quotes:PQ-2026-0184-v3"],
    document: partnerTransferQuote,
  }),
  fixture({
    kind: "partner_resale_quote",
    label: demoMessage("experience.data.artifact.customerQuotation", {
      reference: "EP-QT-9007",
    }),
    subjectType: "quote",
    subjectId: subject("quote", "quote-resale-customer-v4"),
    sourceVersion: "4",
    audience: "partner",
    accountId: accounts.reseller,
    attachments: [
      "partner:quotes:quote-resale-customer-v4",
      "partner:quotes:PQ-2026-0171-v1",
    ],
    document: partnerResaleQuote,
  }),
  fixture({
    kind: "partner_transfer_quote",
    label: demoMessage("experience.data.artifact.twoTierQuote", {
      reference: "PQ-2026-0152-v2",
    }),
    subjectType: "quote",
    subjectId: subject("quote", "quote-distributor-exception-v1"),
    sourceVersion: "2",
    audience: "partner",
    accountId: accounts.distributor,
    attachments: [
      "partner:quotes:quote-distributor-exception-v1",
      "partner:quotes:PQ-2026-0152-v2",
    ],
    document: distributorQuote,
  }),
  fixture({
    kind: "commission_statement",
    label: demoMessage("experience.data.artifact.commissionStatement", {
      reference: "STM-2026-Q3",
    }),
    subjectType: "commission_statement",
    subjectId: subject("commission_statement", "STM-2026-Q3"),
    sourceVersion: "1",
    audience: "partner",
    accountId: accounts.reseller,
    attachments: ["partner:commissions:STM-2026-Q3"],
    document: () => Promise.resolve(commissionStatement()),
  }),
  fixture({
    kind: "reconciliation_report",
    label: demoMessage("experience.data.artifact.reconciliation", {
      reference: "REC-2026-07",
    }),
    subjectType: "marketplace_reconciliation",
    subjectId: subject("marketplace_reconciliation", "REC-2026-07"),
    sourceVersion: "1",
    audience: "internal",
    accountId: null,
    attachments: [
      "internal:queues:EXC-COL-008",
      "internal:queues:queue-price-harborline",
    ],
    document: () => Promise.resolve(reconciliationReport()),
  }),
  fixture({
    kind: "report_export",
    label: demoMessage("experience.data.artifact.renewalExposureExport", {
      reference: "RPT-2026-07",
    }),
    subjectType: "report_export",
    subjectId: subject("report_export", "RPT-2026-07"),
    sourceVersion: "1",
    audience: "internal",
    accountId: null,
    attachments: [
      "internal:reports:RPT-2026-07",
      "internal:dashboard:meridian-archive",
      "internal:dashboard:cobalt-orchard",
      "internal:queues:queue-legal-meridian",
    ],
    document: () => Promise.resolve(reportExport()),
  }),
];

const byId = new Map(
  demoArtifactCatalog.map((entry) => [`${entry.kind}:${entry.id}`, entry]),
);
const bySubject = new Map(
  demoArtifactCatalog.map((entry) => [
    `${entry.kind}:${entry.subjectId}`,
    entry,
  ]),
);
const byAttachment = new Map<string, DemoArtifactFixture[]>();
for (const entry of demoArtifactCatalog)
  for (const attachment of entry.attachments)
    byAttachment.set(attachment, [
      ...(byAttachment.get(attachment) ?? []),
      entry,
    ]);

export function demoArtifactById(
  kind: ArtifactKind,
  id: string,
): DemoArtifactFixture | undefined {
  return byId.get(`${kind}:${id}`);
}

export function demoArtifactBySubject(
  kind: ArtifactKind,
  subjectId: string,
): DemoArtifactFixture | undefined {
  return bySubject.get(`${kind}:${subjectId}`);
}

export interface DemoInvoiceFigures {
  readonly netMinor: string;
  readonly taxMinor: string;
  readonly grossMinor: string;
  readonly currency: "USD" | "EUR" | "GBP";
  /** One line naming the treatment and the authorities that ruled on it. */
  readonly summary: string;
}

let invoiceFigures: Promise<DemoInvoiceFigures> | undefined;

/**
 * The tax on the demo's monthly invoice, for the surfaces that show a figure
 * rather than a document.
 *
 * The billing collection states an "invoiced amount", and an invoiced amount is
 * gross. Writing `$15,400.00` into the fixture and `$17,132.50` onto the PDF
 * would be exactly the drift the shared engine exists to prevent, so the
 * collection reads its number from the same determination the PDF is built
 * from. Memoized because the engine is pure: the same request under the same
 * book is the same answer every time.
 */
export function demoInvoiceFigures(): Promise<DemoInvoiceFigures> {
  invoiceFigures ??= determinationFor(
    supplierUs,
    customerMeridian,
    monthlyInvoiceLines,
    "invoice",
  ).then((result) => ({
    netMinor: result.totals.netMinor,
    taxMinor: result.totals.taxMinor,
    grossMinor: result.totals.grossMinor,
    currency: result.totals.currency,
    summary: [
      ...new Set(
        result.lines.map(
          (line) => `${line.jurisdiction} ${formatRatePpm(line.ratePpm)}`,
        ),
      ),
    ].join(" + "),
  }));
  return invoiceFigures;
}

/**
 * The delivery entries a projection row carries, in the shape
 * `ArtifactDeliveryList` reads. `stored` is the honest state: the demo renders
 * on read, so the document is always there.
 */
export function demoRecordArtifacts(
  audience: ExperienceAudience,
  channel: string,
  recordKey: string,
): readonly {
  kind: ArtifactKind;
  id: string;
  label: DemoMessage;
  state: "stored";
}[] {
  return (byAttachment.get(`${audience}:${channel}:${recordKey}`) ?? []).map(
    (entry) => ({
      kind: entry.kind,
      id: entry.id,
      label: entry.label,
      state: "stored" as const,
    }),
  );
}
