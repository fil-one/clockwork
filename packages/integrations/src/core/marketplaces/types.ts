import type {
  Currency,
  IdempotencyKey,
  Money,
  ProviderResult,
  Quantity,
} from "@clockwork/contracts";

export type MarketplaceProvider = "aws" | "azure" | "google";
export type MarketplaceFinancialEventKind =
  | "order"
  | "entitlement"
  | "metering"
  | "fee"
  | "invoice"
  | "settlement"
  | "refund";

export interface MarketplaceFinancialEvent {
  readonly schemaVersion: 1;
  readonly provider: MarketplaceProvider;
  readonly kind: MarketplaceFinancialEventKind;
  readonly externalEventId: string;
  readonly externalOrderId: string;
  readonly externalEntitlementId?: string;
  readonly externalInvoiceId?: string;
  readonly externalSettlementId?: string;
  readonly buyerReference: string;
  readonly productCode: string;
  readonly sku: string;
  readonly occurredAt: string;
  readonly periodStartsAt?: string;
  readonly periodEndsAt?: string;
  readonly quantity?: Quantity;
  readonly amount?: Money;
  readonly fee?: Money;
  readonly status: string;
  readonly sourceHash: string;
}

export interface MarketplaceCredentialStatus {
  readonly provider: MarketplaceProvider;
  readonly ready: boolean;
  readonly missing: readonly string[];
  readonly mode: string;
}

export interface MarketplaceCredentialGate {
  status(): MarketplaceCredentialStatus;
  assertReady(operation: string): void;
}

export interface MarketplaceTransportRequest {
  readonly provider: MarketplaceProvider;
  readonly operation: string;
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
}

export interface MarketplaceTransportResponse {
  readonly status: number;
  readonly body: unknown;
  readonly requestId?: string;
}

export interface MarketplaceTransport {
  /** Implementations apply OAuth/SigV4 and must never log credential material. */
  request(
    input: MarketplaceTransportRequest,
  ): Promise<ProviderResult<MarketplaceTransportResponse>>;
}

export interface MarketplaceFinanceAdapter {
  readonly provider: MarketplaceProvider;
  credentialStatus(): MarketplaceCredentialStatus;
  normalize(raw: unknown): ProviderResult<MarketplaceFinancialEvent>;
  acceptOrder(input: {
    readonly externalOrderId: string;
    readonly externalEntitlementId: string;
    readonly buyerReference: string;
    readonly productCode: string;
    readonly planId: string;
    readonly idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ operationId: string; status: string }>>;
  getEntitlement(input: {
    readonly externalEntitlementId: string;
    readonly buyerReference: string;
    readonly productCode: string;
  }): Promise<
    ProviderResult<{
      externalEntitlementId: string;
      status: string;
      planId?: string;
      raw: unknown;
    }>
  >;
  reportUsage(input: {
    readonly externalEntitlementId: string;
    readonly buyerReference: string;
    readonly productCode: string;
    readonly dimension: string;
    readonly quantity: Quantity;
    readonly occurredAt: string;
    readonly usageEventId: string;
    readonly idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ meteringRecordId: string; status: string }>>;
  listFinancialEvents(input: {
    readonly from: string;
    readonly to: string;
    readonly cursor?: string;
  }): Promise<
    ProviderResult<{
      events: readonly MarketplaceFinancialEvent[];
      nextCursor?: string;
    }>
  >;
}

export interface MarketplaceReconciliationLine {
  readonly provider: MarketplaceProvider;
  readonly externalOrderId: string;
  readonly sku: string;
  readonly currency: Currency;
  readonly meteredQuantity: Quantity;
  readonly invoicedMinor: string;
  readonly settledMinor: string;
  readonly feeMinor: string;
  readonly refundedMinor: string;
  readonly settlementVarianceMinor: string;
  readonly status:
    "tied" | "variance" | "missing_invoice" | "missing_settlement";
}
