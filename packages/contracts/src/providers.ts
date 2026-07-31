import type { Actor, EventEnvelope } from "./events";
import type {
  AccountId,
  DocumentId,
  IdempotencyKey,
  InvoiceId,
  Money,
  OrderId,
  OrganizationId,
} from "./primitives";

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

export interface TaxPort {
  validateTaxId(input: {
    country: string;
    value: string;
  }): Promise<ProviderResult<{ valid: boolean; normalized: string }>>;
  calculate(input: {
    accountId: AccountId;
    lines: readonly { taxCode: string; amount: Money }[];
  }): Promise<ProviderResult<{ tax: Money }>>;
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
  tax: TaxPort;
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
