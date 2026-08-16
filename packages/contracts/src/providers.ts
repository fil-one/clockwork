import { z } from "zod";

import type { Actor, EventEnvelope } from "./events";
import { CurrencySchema, MinorUnitSchema, QuantitySchema } from "./primitives";
import type {
  AccountId,
  Currency,
  DocumentId,
  IdempotencyKey,
  InvoiceId,
  MinorUnit,
  Money,
  OrderId,
  OrganizationId,
} from "./primitives";

/** Canonical verified payload accepted by the marketplace persistence path. */
export const MarketplaceEventPayloadSchema = z
  .object({
    type: z.string().trim().min(1),
    eventId: z.string().trim().min(1),
    provider: z.enum(["aws", "azure", "google"]),
    providerAccountReference: z.string().trim().min(1),
    accountId: z.uuid().nullable(),
    orderId: z.uuid().nullable(),
    entitlementId: z.uuid().nullable(),
    occurredAt: z.iso.datetime({ offset: true }),
    currency: CurrencySchema.nullable(),
    grossMinor: MinorUnitSchema.nullable(),
    feeMinor: MinorUnitSchema.nullable(),
    taxMinor: MinorUnitSchema.nullable(),
    netMinor: MinorUnitSchema.nullable(),
    quantity: QuantitySchema.nullable(),
    sequence: z.number().int().positive(),
  })
  .strict();
export type MarketplaceEventPayload = z.infer<
  typeof MarketplaceEventPayloadSchema
>;

export type ProviderFailureKind = "transient" | "permanent";
export type ProviderResult<T> =
  | { ok: true; value: T; duplicate?: boolean }
  | {
      ok: false;
      kind: ProviderFailureKind;
      code: string;
      message: string;
      retryAfterMs?: number;
    };

export interface BillingPort {
  createCustomer(input: {
    accountId: AccountId;
    email: string;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ customerId: string }>>;
  issueInvoice(input: {
    invoiceId: InvoiceId;
    customerId: string;
    orderId: OrderId;
    amount: Money;
    poNumber?: string;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ providerInvoiceId: string; status: string }>>;
  createRefund(input: {
    paymentId: string;
    amount: Money;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ refundId: string }>>;
}

export interface SignaturePort {
  createEnvelope(input: {
    accountId: AccountId;
    documentId: DocumentId;
    signerEmail: string;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ envelopeId: string; signingUrl: string }>>;
  downloadCompletedDocument(
    envelopeId: string,
  ): Promise<ProviderResult<{ bytes: Uint8Array; certificate: Uint8Array }>>;
}

export interface ProvisioningPort {
  provision(input: {
    orderId: OrderId;
    organizationId: OrganizationId;
    entitlements: readonly { sku: string; quantity: string; region: string }[];
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ operationId: string }>>;
  teardown(input: {
    organizationId: OrganizationId;
    approvalIds: readonly [string, string];
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ operationId: string }>>;
}

export interface CrmPort {
  projectEvent(
    event: EventEnvelope,
  ): Promise<ProviderResult<{ projectionId: string }>>;
}

export interface AccountingPort {
  postInvoice(input: {
    invoiceId: InvoiceId;
    mode: "payout_summary" | "accounts_receivable";
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ postingId: string }>>;
  postCommissionBill(input: {
    statementId: DocumentId;
    amount: Money;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ billId: string }>>;
}

export interface ScreeningPort {
  screen(input: {
    accountId: AccountId;
    legalName: string;
    country: string;
    reason: "registration" | "pre_signature" | "partner_activation";
  }): Promise<
    ProviderResult<{
      decision: "clear" | "review" | "blocked";
      reference: string;
    }>
  >;
}

/**
 * How a supply is treated on the document and in the return. Six values, not
 * three, because the three collapsed four materially different situations that
 * a bookkeeper, an auditor and a VAT return each handle differently:
 *
 *   - `standard` — in scope, charged at the jurisdiction's rate. The only value
 *     that admits a non-zero amount.
 *   - `reverse_charge` — in scope in the customer's jurisdiction, accounted for
 *     by the customer. Billed net, and the document must carry the notation.
 *   - `zero_rated` — in scope at 0%. Input tax on the costs behind it stays
 *     recoverable.
 *   - `exempt` — in scope, no tax, and input tax is NOT recoverable. Same zero
 *     on the invoice as `zero_rated`, a different number in the accounts.
 *   - `out_of_scope` — outside the tax's territory entirely. Must not appear in
 *     a VAT return at all, which is why it cannot share a value with `exempt`.
 *   - `not_registered` — a real taxing jurisdiction, at a real rate, where the
 *     supplier holds no registration. Nothing is charged and nothing is owed
 *     yet, but this is the value a registration-threshold breach is detected
 *     from after the fact: count these rows per jurisdiction and compare them
 *     against the threshold the rule book carries. Collapsing it into `exempt`
 *     is how a threshold gets crossed silently.
 *
 * The values are the vocabulary. Which one applies to a given supply is decided
 * by the determination engine from rule-book data, never by a literal here.
 */
export type TaxTreatment =
  | "standard"
  | "reverse_charge"
  | "zero_rated"
  | "exempt"
  | "out_of_scope"
  | "not_registered";

/**
 * The supply's nature, which decides where it is supplied. `service` and
 * `digital_service` diverge for a consumer: a digital service is supplied where
 * the customer is (stable since 2015), a general service where the supplier is.
 */
export type TaxSupplyType = "service" | "digital_service" | "goods";

export type TaxDocumentType = "invoice" | "credit_note" | "proforma";

/** Whether the rate applies line by line or to the invoice total. Data. */
export type TaxRoundingConvention = "line" | "invoice";

/**
 * A tax registration, on either side of the transaction. `verifiedAt` and
 * `evidenceReference` are not decoration: to defend a reverse charge you must
 * be able to demonstrate that you validated the customer's number at the time
 * of supply, and a registration carrying neither is an unvalidated one.
 */
export interface TaxRegistration {
  jurisdiction: string;
  /** Rule-book scheme id: which register this number sits on. */
  scheme: string;
  number: string;
  /** ISO instant the number was last validated against the register. */
  verifiedAt?: string;
  /** ISO instant the registration lapses, when the register states one. */
  expiresAt?: string;
  /** Where the proof of that validation is kept. */
  evidenceReference?: string;
}

export interface TaxExemptionCertificate {
  jurisdiction: string;
  certificateId: string;
  /** ISO dates bounding the certificate's validity. */
  validFrom?: string;
  validUntil?: string;
  reason?: string;
  evidenceReference?: string;
}

export interface TaxAddress {
  region?: string;
  postalCode?: string;
  country: string;
}

/**
 * Our side of the transaction: the entity making the supply. Its absence from
 * the old contract is why that contract could not go global — every
 * place-of-supply rule is a comparison between the two sides, and a request
 * carrying only one of them can only ever answer for a domestic supply.
 */
export interface TaxSupplier {
  legalEntityId: string;
  establishedCountry: string;
  registrations: readonly TaxRegistration[];
}

export interface TaxCustomer {
  accountId: AccountId;
  country: string;
  address: TaxAddress;
  status: "business" | "consumer";
  registrations: readonly TaxRegistration[];
  exemptionCertificates: readonly TaxExemptionCertificate[];
}

export interface TaxDeterminationRequestLine {
  /**
   * The `core_order_line_snapshots` id, so every answer maps back to the
   * immutable line it was determined against.
   */
  lineId: string;
  /** The frozen per-line code, which that same snapshot already carries. */
  taxCode: string;
  supplyType: TaxSupplyType;
  netAmount: Money;
}

export interface TaxDeterminationRequest {
  supplier: TaxSupplier;
  customer: TaxCustomer;
  lines: readonly TaxDeterminationRequestLine[];
  /** Tax point: the invoice date for services absent prepayment. */
  taxPointDate: string;
  documentType: TaxDocumentType;
  /**
   * Present when this document reverses another. A credit note must be
   * determined under the rule book the original was determined under, so the
   * pins travel with it and a determination made under any other book is
   * refused rather than silently credited at today's rate.
   */
  reversalOf?: {
    invoiceId: InvoiceId;
    pinnedRuleBookIds: readonly string[];
  };
}

/**
 * One taxing jurisdiction's answer for one line. A line produces several of
 * these where jurisdictions stack: US sales tax is state plus county plus city
 * plus district, and a single figure per line cannot express which authority is
 * owed what. Both Stripe Tax (`tax_breakdown` per line item) and Avalara
 * (`CreateTransaction` line `details`) answer in exactly this shape, so an
 * adapter can satisfy this seam without translation loss.
 */
export interface TaxDeterminationResultLine {
  lineId: string;
  jurisdiction: string;
  treatment: TaxTreatment;
  taxCode: string;
  /** The rule book that produced this row: the pin that makes it reproducible. */
  ruleBookId: string;
  ruleBookVersion: number;
  /** Parts per million, so a 7.25% rate is exact and 0.375% is expressible. */
  ratePpm: number;
  /** Rule-book vocabulary — `standard`, `reduced`, `zero`, and so on. */
  rateKind: string;
  taxableMinor: MinorUnit;
  taxMinor: MinorUnit;
  legalBasis: string;
  /** Wording the document must carry, e.g. the reverse-charge statement. */
  notation: string;
}

export interface TaxDeterminationTotals {
  currency: Currency;
  netMinor: MinorUnit;
  taxMinor: MinorUnit;
  grossMinor: MinorUnit;
  /**
   * Net and tax split by treatment. This is what makes `not_registered`
   * countable without re-deriving it from the lines.
   */
  byTreatment: readonly {
    treatment: TaxTreatment;
    netMinor: MinorUnit;
    taxMinor: MinorUnit;
  }[];
}

export interface TaxDeterminationResult {
  determinationId: string;
  /**
   * The territories the document's supplies land in, in line order and
   * deduplicated. A single scalar would be a wrong number for a document whose
   * lines are supplied in different places, which mixed supply types can be.
   */
  placeOfSupply: readonly string[];
  confidence: "determined" | "review_required";
  reviewReasons: readonly string[];
  /** The supplier registration the determination leaned on, when one applied. */
  supplierRegistration?: TaxRegistration;
  /** The customer registration that carried a reverse charge, when one did. */
  customerRegistration?: TaxRegistration;
  rounding: TaxRoundingConvention;
  lines: readonly TaxDeterminationResultLine[];
  totals: TaxDeterminationTotals;
}

export interface TaxIdentifierValidation {
  valid: boolean;
  normalized: string;
  /**
   * Whether this identifier lets the supply be reverse charged. Derived from
   * the registration the register returned, never from the country code the
   * registrant typed.
   */
  reverseChargeEligible: boolean;
  /** Rule-book scheme the number was found on, when the register names one. */
  scheme?: string;
  /** ISO instant of the check — the "at the time of supply" half of the proof. */
  verifiedAt: string;
  /** Where the register's answer is retained. A boolean keeps nothing. */
  evidenceReference: string;
}

/**
 * The tax seam. `determine` carries both sides of the transaction and answers
 * per line and per jurisdiction; `validateTaxId` answers with retainable
 * evidence rather than a boolean.
 */
export interface TaxDeterminationPort {
  validateTaxId(input: {
    country: string;
    value: string;
    /** ISO instant the check is made as of. Never read from a clock inside. */
    checkedAt: string;
  }): Promise<ProviderResult<TaxIdentifierValidation>>;
  determine(
    input: TaxDeterminationRequest,
  ): Promise<ProviderResult<TaxDeterminationResult>>;
}

/**
 * @deprecated Superseded by {@link TaxDeterminationPort}. Two defects are baked
 * into this shape and neither can be fixed inside it:
 *
 *   - `jurisdiction` is documented as the merchant-of-record side and is
 *     populated from the invoiced account, which on a resale or distributor
 *     route is the partner — our customer. A US entity selling to a Spanish
 *     reseller determines against ES and bills Spanish VAT on a supply that
 *     should be reverse charged.
 *   - there is no supplier at all, so no place-of-supply rule can be applied.
 *
 * Kept only until the call sites in `@clockwork/db` and `apps/web` move to
 * `determine`; nothing new may be built against it.
 */
export interface TaxPort {
  validateTaxId(input: { country: string; value: string }): Promise<
    ProviderResult<{
      valid: boolean;
      normalized: string;
      reverseChargeEligible: boolean;
    }>
  >;
  calculate(input: {
    accountId: AccountId;
    jurisdiction: string;
    lines: readonly { taxCode: string; amount: Money }[];
  }): Promise<ProviderResult<{ tax: Money; treatment: TaxTreatment }>>;
}

export interface EvidenceStoragePort {
  putImmutable(input: {
    kind: string;
    bytes: Uint8Array;
    contentHash: string;
    retainUntil: string;
    legalHold?: boolean;
  }): Promise<
    ProviderResult<{
      documentId: DocumentId;
      storageKey: string;
      versionId: string;
    }>
  >;
  get(
    documentId: DocumentId,
  ): Promise<ProviderResult<{ bytes: Uint8Array; contentHash: string }>>;
}

export interface NotificationPort {
  send(input: {
    template: string;
    recipients: readonly string[];
    data: Record<string, unknown>;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ messageId: string }>>;
}

export interface SupportFeedPort {
  listSignals(input: { accountId: AccountId; since?: string }): Promise<
    ProviderResult<
      readonly {
        externalId: string;
        severity: string;
        openedAt: string;
        status: string;
      }[]
    >
  >;
}

export interface OrchestratorUsagePort {
  pullUsage(input: {
    organizationId: OrganizationId;
    from: string;
    to: string;
  }): Promise<
    ProviderResult<
      readonly {
        externalId: string;
        sku: string;
        quantity: string;
        measuredAt: string;
      }[]
    >
  >;
}

export interface ProviderPorts {
  billing: BillingPort;
  signature: SignaturePort;
  provisioning: ProvisioningPort;
  crm: CrmPort;
  accounting: AccountingPort;
  screening: ScreeningPort;
  /** @deprecated Reads the wrong side of the transaction; use `taxDetermination`. */
  tax: TaxPort;
  taxDetermination: TaxDeterminationPort;
  evidence: EvidenceStoragePort;
  notifications: NotificationPort;
  support: SupportFeedPort;
  usage: OrchestratorUsagePort;
}

export interface WebhookVerificationResult<T> {
  eventId: string;
  occurredAt: string;
  payload: T;
}

export interface WebhookVerifier<T> {
  verify(input: {
    rawBody: Uint8Array;
    signature: string;
    toleranceSeconds?: number;
  }): Promise<WebhookVerificationResult<T>>;
}

export interface ActionAuditContext {
  actor: Actor;
  requestId: string;
  origin: string;
}
