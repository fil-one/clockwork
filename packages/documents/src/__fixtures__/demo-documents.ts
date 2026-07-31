import { sha256 } from "../format";
import type {
  AmendmentDocumentInput,
  BaseDocumentInput,
  CommerceDocumentInput,
  CommissionStatementDocumentInput,
  DeletionCertificateDocumentInput,
  DocumentLineItem,
  DocumentTotals,
  InvoiceDocumentInput,
  Money,
  OrderFormDocumentInput,
  Party,
  PocDocumentInput,
  QuoteDocumentInput,
  RenewalConfirmationDocumentInput,
  ReportDocumentInput,
  SupportedCurrency,
} from "../model";

const issuedAt = "2026-07-31T16:00:00.000Z";
const period = { endDate: "2027-07-31", startDate: "2026-08-01" } as const;

const filOne: Party = {
  address: {
    countryCode: "US",
    line1: "451 Fictional Harbor Way",
    locality: "Wilmington",
    postalCode: "19801",
    region: "DE",
  },
  contactEmail: "commerce@filone.example",
  legalName: "Fil One, Inc.",
  taxId: "US-TAX-DEMO-001",
};

const buyer: Party = {
  address: {
    countryCode: "ES",
    line1: "42 Avenida Imaginaria",
    locality: "Madrid",
    postalCode: "28013",
  },
  contactEmail: "procurement@northstar-archive.example",
  contactName: "Elena Marquez",
  legalName: "Northstar Archive, S.L.",
  taxId: "ESB00000000",
};

const partner: Party = {
  address: {
    countryCode: "GB",
    line1: "18 Imaginary Exchange",
    locality: "London",
    postalCode: "EC2A 1AA",
  },
  contactEmail: "deals@cinderbridge.example",
  contactName: "Morgan Reed",
  legalName: "Cinderbridge Systems Ltd.",
  taxId: "GB000000000",
};

const endClient: Party = {
  address: {
    countryCode: "GB",
    line1: "7 Sample Quay",
    locality: "Bristol",
    postalCode: "BS1 4ST",
  },
  legalName: "Meridian Film Archive Ltd.",
};

function sourceHash(value: string): string {
  return sha256(new TextEncoder().encode(value));
}

function base(
  kind: BaseDocumentInput["kind"],
  documentId: string,
  recipient: Party = buyer,
): BaseDocumentInput {
  return {
    documentId,
    issuedAt,
    issuer: filOne,
    kind,
    locale: recipient.address.countryCode === "ES" ? "es-ES" : "en-GB",
    recipient,
    verification: {
      objectVersion: "commerce-v3",
      recordHash: sourceHash(`${kind}:${documentId}:3`),
      verificationUrl: `https://verify.filone.example/documents/${documentId}`,
    },
    version: "3",
  };
}

function money(currency: SupportedCurrency, minorUnits: string): Money {
  return { currency, minorUnits };
}

function totals(
  currency: SupportedCurrency,
  subtotal = "1680000",
  tax = "352800",
  total = "2032800",
): DocumentTotals {
  return {
    subtotal: money(currency, subtotal),
    tax: money(currency, tax),
    taxLabel: currency === "USD" ? "Sales tax" : "VAT",
    total: money(currency, total),
  };
}

function lineItems(
  currency: SupportedCurrency,
  count = 3,
): readonly DocumentLineItem[] {
  return Array.from({ length: count }, (_, index) => ({
    amount: money(currency, String(420_000 + index * 12_500)),
    description: `Archive capacity - region ${String(index + 1).padStart(2, "0")}`,
    detail: "Term-drawdown committed capacity with contracted overage pricing",
    id: `line-${index + 1}`,
    quantity: `${500 + index * 25}`,
    taxLabel: currency === "USD" ? "Taxable" : "VAT standard rate",
    unitLabel: "TB-month",
    unitPrice: money(currency, "840"),
  }));
}

const directQuote: QuoteDocumentInput = {
  ...base("direct_quote", "QT-DIRECT-0042"),
  agreementReference: "CSA-EU-2026-03",
  commercialTerms: [
    "Usage above committed capacity is billed monthly in arrears at the contracted overage rate shown on each line.",
    "Prices remain valid through the stated validity date and are exclusive of taxes except where shown.",
    "The accepted quote version and governing agreement version are pinned to the resulting order.",
  ],
  currency: "EUR",
  kind: "direct_quote",
  lineItems: lineItems("EUR", 22),
  paymentTerms: "Annual prepayment; SEPA bank transfer",
  purchaseOrderRequired: true,
  quoteNumber: "QT-DIRECT-0042",
  servicePeriod: period,
  totals: totals("EUR", "12155000", "2552550", "14707550"),
  validUntil: "2026-08-21",
};

const partnerTransferQuote: QuoteDocumentInput = {
  ...base("partner_transfer_quote", "QT-TRANSFER-0017", partner),
  agreementReference: "PARTNER-RESALE-2026-02",
  commercialTerms: [
    "Transfer prices are confidential partner commercial information.",
    "The partner is merchant of record to the named end client.",
  ],
  currency: "GBP",
  endClient,
  kind: "partner_transfer_quote",
  lineItems: lineItems("GBP", 4),
  paymentTerms: "Net 30 days; BACS",
  quoteNumber: "QT-TRANSFER-0017",
  servicePeriod: period,
  totals: totals("GBP", "1725000", "345000", "2070000"),
  validUntil: "2026-08-14",
};

const partnerResaleQuote: QuoteDocumentInput = {
  ...base("partner_resale_quote", "CB-QT-9007", endClient),
  brand: {
    accentColor: "#334D68",
    legalFooter: "Cinderbridge customer quotation",
    legalName: partner.legalName,
    supportEmail: "support@cinderbridge.example",
    wordmark: "CINDERBRIDGE",
  },
  commercialTerms: [
    "This customer quotation is issued by Cinderbridge Systems Ltd.",
    "Questions about pricing, payment, or renewal should be directed to Cinderbridge.",
  ],
  currency: "GBP",
  issuer: partner,
  kind: "partner_resale_quote",
  lineItems: lineItems("GBP", 3),
  paymentTerms: "Annual prepayment; BACS",
  quoteNumber: "CB-QT-9007",
  servicePeriod: period,
  totals: totals("GBP", "2140000", "428000", "2568000"),
  validUntil: "2026-08-14",
  verification: {
    objectVersion: "commerce-v3",
    recordHash: sourceHash("partner_resale_quote:CB-QT-9007:3"),
    verificationUrl: "https://verify.cinderbridge.example/documents/CB-QT-9007",
  },
};

const orderForm: OrderFormDocumentInput = {
  ...base("order_form", "ORD-2026-00118"),
  currency: "EUR",
  governingAgreementReference: "CSA-EU-2026-03",
  kind: "order_form",
  lineItems: lineItems("EUR", 5),
  orderNumber: "ORD-2026-00118",
  paymentTerms: "Net 30 days; SEPA",
  purchaseOrderNumber: "PO-NORTHSTAR-7781",
  quoteReference: "QT-DIRECT-0042-v3",
  servicePeriod: period,
  signer: {
    acceptedAt: "2026-07-31T15:58:00.000Z",
    authorityAttestation:
      "I am authorized to bind Northstar Archive, S.L. to this order form.",
    name: "Elena Marquez",
    title: "Director of Procurement",
  },
  totals: totals("EUR"),
};

const amendment: AmendmentDocumentInput = {
  ...base("amendment", "AMD-2026-0009"),
  acceptedBy: {
    acceptedAt: "2026-07-31T15:59:00.000Z",
    name: "Elena Marquez",
    title: "Director of Procurement",
  },
  amendmentNumber: "AMD-2026-0009",
  deltaLines: [
    {
      amount: money("EUR", "360000"),
      change: "add",
      description: "EU committed archive expansion",
      detail: "Co-terminated with the existing service period",
      id: "delta-1",
      quantity: "250",
      unitLabel: "TB-month",
    },
    {
      amount: money("EUR", "-45000"),
      change: "remove",
      description: "Superseded onboarding line",
      id: "delta-2",
      quantity: "1",
      unitLabel: "one-time",
    },
  ],
  effectiveDate: "2026-09-01",
  governingAgreementReference: "CSA-EU-2026-03",
  kind: "amendment",
  netChange: money("EUR", "315000"),
  parentOrderReference: "ORD-2026-00118",
  prorationMethod: "Daily actual / 365, co-terminated",
  resultingTerm: period,
};

function poc(kind: PocDocumentInput["kind"]): PocDocumentInput {
  const id = kind === "poc_summary" ? "POC-2026-0021-S" : "POC-2026-0021-F";
  return {
    ...base(kind, id),
    capacityCap: "250 TB stored",
    egressCap: "15 TB during POC",
    kind,
    metrics: [
      {
        context: "daily peak",
        id: "metric-1",
        label: "Ingest throughput",
        value: "18.4 Gbps",
      },
      {
        context: "sampled retrievals",
        id: "metric-2",
        label: "Integrity checks",
        value: "100% passed",
      },
    ],
    outcome:
      kind === "poc_final_report"
        ? "All agreed success tests completed. The isolated tenant remains available for in-place conversion."
        : "Validation is in progress with the final report scheduled before expiry.",
    ownerName: "Priya Shah",
    permittedDataClass: "Encrypted business archive; no regulated health data",
    pocNumber: "POC-2026-0021",
    recommendation:
      kind === "poc_final_report"
        ? "Convert the existing tenant to the annual committed offer without moving stored data."
        : "Complete the retrieval exercise and confirm the production commit range.",
    servicePeriod: { endDate: "2026-08-28", startDate: "2026-08-01" },
    status: kind === "poc_final_report" ? "Completed" : "Active",
    successTests: [
      {
        id: "test-1",
        label: "Sustain agreed ingest throughput",
        observed: "18.4 Gbps",
        result: "passed",
        target: ">= 15 Gbps",
      },
      {
        id: "test-2",
        label: "Retrieve representative archive sample",
        ...(kind === "poc_final_report" ? { observed: "100% verified" } : {}),
        result: kind === "poc_final_report" ? "passed" : "pending",
        target: "100% checksum match",
      },
      {
        id: "test-3",
        label: "Validate retention policy behavior",
        observed: "Policy verified in isolated account",
        result: "passed",
        target: "No early delete path",
      },
    ],
    workload: "Long-term preservation of production media masters",
  };
}

function invoice(kind: InvoiceDocumentInput["kind"]): InvoiceDocumentInput {
  const id = kind === "receipt" ? "RCT-2026-1198" : "INV-2026-1198-C";
  return {
    ...base(kind, id),
    amountPaid: money("EUR", kind === "receipt" ? "2032800" : "0"),
    balanceDue: money("EUR", kind === "receipt" ? "0" : "2032800"),
    currency: "EUR",
    dueDate: "2026-08-30",
    invoiceNumber: "INV-2026-1198",
    kind,
    lineItems: lineItems("EUR", 3),
    orderReference: "ORD-2026-00118",
    ...(kind === "receipt"
      ? {
          paidAt: "2026-08-04T11:30:00.000Z",
          paymentMethod: "SEPA bank transfer",
          paymentReference: "SEPA-TEST-4471",
        }
      : {}),
    purchaseOrderNumber: "PO-NORTHSTAR-7781",
    totals: totals("EUR"),
  };
}

const commissionStatement: CommissionStatementDocumentInput = {
  ...base("commission_statement", "COM-2026-Q3-001", partner),
  clawbacks: money("GBP", "-8400"),
  grossCommission: money("GBP", "98400"),
  holdback: money("GBP", "-10000"),
  kind: "commission_statement",
  lines: Array.from({ length: 18 }, (_, index) => ({
    adjustment: index === 5 ? money("GBP", "-8400") : money("GBP", "0"),
    ...(index === 5 ? { adjustmentReason: "Credit note CN-204 applied" } : {}),
    collectedRevenue: money("GBP", String(63_000 + index * 2_000)),
    commissionRateBasisPoints: 1200,
    earned: money("GBP", String(7_560 + index * 240)),
    endClientName: `Fictional portfolio client ${index + 1}`,
    id: `commission-${index + 1}`,
    invoiceReference: `INV-P-${String(index + 1).padStart(4, "0")}`,
  })),
  netPayable: money("GBP", "80000"),
  paymentStatus: "Approved for QBO bill creation",
  period: { endDate: "2026-09-30", startDate: "2026-07-01" },
  statementNumber: "COM-2026-Q3-001",
};

function renewal(
  kind: RenewalConfirmationDocumentInput["kind"],
): RenewalConfirmationDocumentInput {
  const declined = kind === "decline_confirmation";
  return {
    ...base(kind, declined ? "DEC-2026-0033" : "REN-2026-0033"),
    agreementReference: "CSA-EU-2026-03",
    confirmationNumber: declined ? "DEC-2026-0033" : "REN-2026-0033",
    confirmationText: declined
      ? "Non-renewal notice has been recorded for the referenced order. Service remains active through the current term end date."
      : "Renewal has been confirmed for the next service term under the referenced agreement and accepted quote version.",
    currentTerm: period,
    effectiveDate: "2027-08-01",
    kind,
    ...(declined
      ? { noticeServedOn: "2027-04-15" }
      : {
          nextTerm: { endDate: "2028-07-31", startDate: "2027-08-01" },
        }),
    orderReference: "ORD-2026-00118",
    recordedBy: "Elena Marquez, Director of Procurement",
    renewalType: declined ? "expires" : "manual",
  };
}

const deletionCertificate: DeletionCertificateDocumentInput = {
  ...base("deletion_certificate", "DEL-2026-0008"),
  accountReference: "ACC-NORTHSTAR-0041",
  approvedBy: [
    {
      approvedAt: "2026-07-31T15:40:00.000Z",
      name: "Avery Chen",
      role: "Operations approver",
    },
    {
      approvedAt: "2026-07-31T15:44:00.000Z",
      name: "Samira Holt",
      role: "Security approver",
    },
  ],
  certificateNumber: "DEL-2026-0008",
  completedAt: "2026-07-31T15:55:00.000Z",
  deletionMethod: "Cryptographic erasure followed by provider confirmation",
  deletionScope: [
    "Application credentials and active access grants",
    "Mutable archive objects outside active retention",
    "Temporary indexes, caches, and derived metadata",
  ],
  kind: "deletion_certificate",
  orchestratorConfirmation: "ORCH-DELETE-DEMO-1188",
  orderReference: "ORD-2025-00088",
  retentionExclusions: [
    {
      id: "retention-1",
      reason: "Active Object Lock compliance retention",
      retentionExpiresOn: "2027-11-14",
      scope: "Archive vault eu-demo-07 / 18.4 TB",
    },
    {
      id: "retention-2",
      reason: "Contract evidence retention",
      retentionExpiresOn: "2033-07-31",
      scope: "Executed agreements and acceptance evidence",
    },
  ],
};

function report(kind: ReportDocumentInput["kind"]): ReportDocumentInput {
  const reconciliation = kind === "reconciliation_report";
  return {
    ...base(kind, reconciliation ? "REC-2026-07" : "RPT-2026-07"),
    basis: reconciliation
      ? "Commerce ledger compared with Stripe and QBO at invoice grain"
      : "Current commerce records at the generation timestamp",
    columns: [
      { key: "reference", label: "Reference", width: 18 },
      { key: "account", label: "Account", width: 25 },
      { align: "right", key: "platform", label: "Platform", width: 16 },
      { align: "right", key: "external", label: "External", width: 16 },
      { align: "right", key: "variance", label: "Variance", width: 13 },
      { key: "state", label: "State", width: 12 },
    ],
    exceptions: reconciliation
      ? [
          "INV-DEMO-0029 is pending settlement timing confirmation.",
          "QBO journal batch DEMO-07 remains in sandbox review.",
        ]
      : [],
    generatedAt: issuedAt,
    kind,
    period: { endDate: "2026-07-31", startDate: "2026-07-01" },
    reportTitle: reconciliation
      ? "Monthly three-way reconciliation"
      : "Revenue detail export",
    rows: Array.from({ length: 74 }, (_, index) => ({
      emphasis: index === 28 ? "warning" : "normal",
      id: `report-row-${index + 1}`,
      values: {
        account: `Fictional account ${index + 1}`,
        external: `EUR ${(12_000 + index * 175).toLocaleString("en-US")}.00`,
        platform: `EUR ${(12_000 + index * 175).toLocaleString("en-US")}.00`,
        reference: `INV-DEMO-${String(index + 1).padStart(4, "0")}`,
        state: index === 28 ? "Review" : "Matched",
        variance: index === 28 ? "EUR 0.01" : "EUR 0.00",
      },
    })),
    status: reconciliation
      ? "Review complete; two explained timing items"
      : "Final",
    summary: [
      { id: "summary-1", label: "Rows", value: "74" },
      { id: "summary-2", label: "Matched", value: "73" },
      { detail: "explained", id: "summary-3", label: "Exceptions", value: "2" },
      { id: "summary-4", label: "Unexplained variance", value: "EUR 0.00" },
    ],
  };
}

export const demoDocuments: readonly CommerceDocumentInput[] = [
  directQuote,
  partnerTransferQuote,
  partnerResaleQuote,
  orderForm,
  amendment,
  poc("poc_summary"),
  poc("poc_final_report"),
  invoice("invoice_companion"),
  invoice("receipt"),
  commissionStatement,
  renewal("renewal_confirmation"),
  renewal("decline_confirmation"),
  deletionCertificate,
  report("reconciliation_report"),
  report("report_export"),
];
