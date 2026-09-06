export const DOCUMENT_KINDS = [
  "direct_quote",
  "partner_transfer_quote",
  "partner_resale_quote",
  "order_form",
  "amendment",
  "poc_summary",
  "poc_final_report",
  "invoice_companion",
  "receipt",
  "commission_statement",
  "renewal_confirmation",
  "decline_confirmation",
  "deletion_certificate",
  "reconciliation_report",
  "report_export",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type SupportedCurrency = "USD" | "EUR" | "GBP";
export type FormattingLocale = "en-US" | "en-GB" | "en-IE" | "es-ES";

export interface Money {
  currency: SupportedCurrency;
  /** Signed integer minor units, serialized as a decimal string. */
  minorUnits: string;
}

export interface PostalAddress {
  line1: string;
  line2?: string;
  locality: string;
  region?: string;
  postalCode: string;
  countryCode: "US" | "GB" | "ES" | (string & {});
}

export interface Party {
  legalName: string;
  address: PostalAddress;
  taxId?: string;
  contactName?: string;
  contactEmail?: string;
}

export interface BrandConfig {
  /** Printed when the brand supplies no logo. */
  wordmark: string;
  /**
   * Base64 PNG or JPEG data URI. Remote URLs are rejected so rendering a
   * tenant-supplied brand never makes the server fetch an outside address.
   */
  logo?: string;
  legalName: string;
  accentColor?: `#${string}`;
  supportEmail?: string;
  legalFooter?: string;
}

export interface VerificationDetails {
  /** Hash of the immutable commerce record or source artifact. */
  recordHash: string;
  objectVersion?: string;
  verificationUrl?: string;
}

export interface BaseDocumentInput {
  kind: DocumentKind;
  documentId: string;
  version: string;
  issuedAt: string;
  locale: FormattingLocale;
  issuer: Party;
  recipient: Party;
  brand?: BrandConfig;
  verification: VerificationDetails;
  notes?: readonly string[];
}

export interface DocumentLineItem {
  id: string;
  description: string;
  detail?: string;
  quantity?: string;
  unitLabel?: string;
  unitPrice?: Money;
  amount: Money;
  taxLabel?: string;
}

export interface DocumentTotals {
  subtotal: Money;
  discount?: Money;
  tax?: Money;
  taxLabel?: string;
  total: Money;
}

export interface ServicePeriod {
  startDate: string;
  endDate: string;
}

export interface QuoteDocumentInput extends BaseDocumentInput {
  kind: "direct_quote" | "partner_transfer_quote" | "partner_resale_quote";
  quoteNumber: string;
  validUntil: string;
  currency: SupportedCurrency;
  lineItems: readonly DocumentLineItem[];
  totals: DocumentTotals;
  servicePeriod?: ServicePeriod;
  agreementReference?: string;
  purchaseOrderRequired?: boolean;
  paymentTerms: string;
  endClient?: Party;
  commercialTerms?: readonly string[];
}

export interface OrderFormDocumentInput extends BaseDocumentInput {
  kind: "order_form";
  orderNumber: string;
  quoteReference: string;
  governingAgreementReference: string;
  purchaseOrderNumber?: string;
  servicePeriod: ServicePeriod;
  currency: SupportedCurrency;
  lineItems: readonly DocumentLineItem[];
  totals: DocumentTotals;
  paymentTerms: string;
  signer: {
    name: string;
    title: string;
    acceptedAt: string;
    authorityAttestation: string;
  };
}

export interface AmendmentLine extends DocumentLineItem {
  change: "add" | "remove" | "replace";
}

export interface AmendmentDocumentInput extends BaseDocumentInput {
  kind: "amendment";
  amendmentNumber: string;
  parentOrderReference: string;
  governingAgreementReference: string;
  effectiveDate: string;
  prorationMethod: string;
  deltaLines: readonly AmendmentLine[];
  netChange: Money;
  resultingTerm?: ServicePeriod;
  acceptedBy?: {
    name: string;
    title: string;
    acceptedAt: string;
  };
}

export interface PocSuccessTest {
  id: string;
  label: string;
  target: string;
  observed?: string;
  result: "pending" | "passed" | "failed" | "not_run";
}

export interface PocMetric {
  id: string;
  label: string;
  value: string;
  context?: string;
}

export interface PocDocumentInput extends BaseDocumentInput {
  kind: "poc_summary" | "poc_final_report";
  pocNumber: string;
  workload: string;
  permittedDataClass: string;
  status: string;
  ownerName: string;
  servicePeriod: ServicePeriod;
  capacityCap: string;
  egressCap: string;
  successTests: readonly PocSuccessTest[];
  metrics?: readonly PocMetric[];
  outcome?: string;
  recommendation?: string;
}

export interface InvoiceDocumentInput extends BaseDocumentInput {
  kind: "invoice_companion" | "receipt";
  invoiceNumber: string;
  orderReference?: string;
  billingPeriodReference?: string;
  purchaseOrderNumber?: string;
  dueDate?: string;
  paidAt?: string;
  paymentReference?: string;
  paymentMethod?: string;
  currency: SupportedCurrency;
  lineItems: readonly DocumentLineItem[];
  totals: DocumentTotals;
  amountPaid: Money;
  balanceDue: Money;
}

export interface CommissionLine {
  id: string;
  endClientName: string;
  invoiceReference: string;
  collectedRevenue: Money;
  commissionRateBasisPoints: number;
  earned: Money;
  adjustment?: Money;
  adjustmentReason?: string;
}

export interface CommissionStatementDocumentInput extends BaseDocumentInput {
  kind: "commission_statement";
  statementNumber: string;
  period: ServicePeriod;
  lines: readonly CommissionLine[];
  grossCommission: Money;
  clawbacks: Money;
  holdback: Money;
  netPayable: Money;
  paymentStatus: string;
}

export interface RenewalConfirmationDocumentInput extends BaseDocumentInput {
  kind: "renewal_confirmation" | "decline_confirmation";
  confirmationNumber: string;
  orderReference: string;
  agreementReference: string;
  currentTerm: ServicePeriod;
  nextTerm?: ServicePeriod;
  noticeServedOn?: string;
  effectiveDate: string;
  renewalType: "automatic" | "manual" | "expires";
  recordedBy: string;
  confirmationText: string;
}

export interface RetentionExclusion {
  id: string;
  scope: string;
  reason: string;
  retentionExpiresOn: string;
}

export interface DeletionCertificateDocumentInput extends BaseDocumentInput {
  kind: "deletion_certificate";
  certificateNumber: string;
  accountReference: string;
  orderReference?: string;
  deletionScope: readonly string[];
  deletionMethod: string;
  completedAt: string;
  orchestratorConfirmation: string;
  retentionExclusions: readonly RetentionExclusion[];
  approvedBy: readonly { name: string; role: string; approvedAt: string }[];
}

export interface ReportColumn {
  key: string;
  label: string;
  align?: "left" | "right";
  width?: number;
}

export interface ReportRow {
  id: string;
  values: Readonly<Record<string, string>>;
  emphasis?: "normal" | "warning" | "critical" | "total";
}

export interface ReportSummaryItem {
  id: string;
  label: string;
  value: string;
  detail?: string;
}

export interface ReportDocumentInput extends BaseDocumentInput {
  kind: "reconciliation_report" | "report_export";
  reportTitle: string;
  period: ServicePeriod;
  generatedAt: string;
  basis: string;
  status?: string;
  columns: readonly ReportColumn[];
  rows: readonly ReportRow[];
  summary: readonly ReportSummaryItem[];
  exceptions?: readonly string[];
}

export type CommerceDocumentInput =
  | QuoteDocumentInput
  | OrderFormDocumentInput
  | AmendmentDocumentInput
  | PocDocumentInput
  | InvoiceDocumentInput
  | CommissionStatementDocumentInput
  | RenewalConfirmationDocumentInput
  | DeletionCertificateDocumentInput
  | ReportDocumentInput;

export interface RenderedDocument {
  bytes: Uint8Array;
  contentHash: string;
  recordHash: string;
  documentId: string;
  version: string;
  fileName: string;
  mimeType: "application/pdf";
}
