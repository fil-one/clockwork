import type {
  AccountId,
  IdempotencyKey,
  InvoiceBillingSource,
  Money,
  OrderId,
  ProviderResult,
} from "@clockwork/contracts";

export type StripeCollectionPolicy =
  | { readonly kind: "auto_charge"; readonly paymentMethodId?: string }
  | { readonly kind: "net_terms"; readonly days: number };

export interface StripeAddressInput {
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly state?: string;
  readonly postalCode: string;
  readonly country: string;
}

export interface StripeCustomerInput {
  readonly accountId: AccountId;
  readonly legalName: string;
  readonly billingEmail: string;
  readonly address?: StripeAddressInput;
  readonly taxIds?: readonly {
    readonly type: "eu_vat" | "gb_vat" | "us_ein" | "es_cif";
    readonly value: string;
  }[];
  readonly taxExempt?: "none" | "exempt" | "reverse";
  readonly idempotencyKey: IdempotencyKey;
}

export interface StripeSubscriptionInput {
  readonly customerId: string;
  readonly orderId: OrderId;
  readonly items: readonly {
    readonly priceId: string;
    readonly quantity?: number;
  }[];
  readonly collection: StripeCollectionPolicy;
  readonly billingAnchorAt?: string;
  readonly idempotencyKey: IdempotencyKey;
}

export interface StripeSubscriptionPhase {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly items: readonly {
    readonly priceId: string;
    readonly quantity?: number;
  }[];
  readonly collection: StripeCollectionPolicy;
}

export interface StripeInvoiceLineInput {
  readonly lineId: string;
  readonly description: string;
  readonly amount: Money;
  readonly taxCode: string;
  readonly servicePeriod?: {
    readonly startsAt: string;
    readonly endsAt: string;
  };
  /** Used to group consolidated resale lines without exposing end-client data elsewhere. */
  readonly endClientAccountId?: AccountId;
}

export type StripeInvoiceInput = InvoiceBillingSource & {
  readonly customerId: string;
  readonly invoiceReference: string;
  readonly currency: Money["currency"];
  readonly lines: readonly StripeInvoiceLineInput[];
  readonly collection: StripeCollectionPolicy;
  readonly poNumber?: string;
  readonly autoFinalize?: boolean;
  readonly idempotencyKey: IdempotencyKey;
};

export interface StripeTaxCalculationInput {
  readonly customerId: string;
  readonly currency: Money["currency"];
  readonly lines: readonly {
    readonly reference: string;
    readonly amount: Money;
    readonly taxCode: string;
    readonly quantity?: number;
  }[];
  readonly idempotencyKey: IdempotencyKey;
}

export interface StripeCommercialGateway {
  createCommercialCustomer(
    input: StripeCustomerInput,
  ): Promise<
    ProviderResult<{ customerId: string; taxIdIds: readonly string[] }>
  >;
  updateCommercialCustomer(
    customerId: string,
    input: Omit<StripeCustomerInput, "idempotencyKey"> & {
      readonly idempotencyKey: IdempotencyKey;
    },
  ): Promise<ProviderResult<{ customerId: string }>>;
  createSubscription(
    input: StripeSubscriptionInput,
  ): Promise<ProviderResult<{ subscriptionId: string; status: string }>>;
  createSubscriptionSchedule(input: {
    readonly customerId: string;
    readonly orderId: OrderId;
    readonly phases: readonly StripeSubscriptionPhase[];
    readonly endBehavior: "release" | "cancel";
    readonly idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ scheduleId: string; status: string }>>;
  createInvoice(
    input: StripeInvoiceInput,
  ): Promise<ProviderResult<{ providerInvoiceId: string; status: string }>>;
  calculateTax(
    input: StripeTaxCalculationInput,
  ): Promise<
    ProviderResult<{ calculationId: string; tax: Money; total: Money }>
  >;
  attachPaymentMethod(input: {
    readonly customerId: string;
    readonly paymentMethodId: string;
    readonly makeDefault: boolean;
    readonly idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ paymentMethodId: string }>>;
  detachPaymentMethod(input: {
    readonly paymentMethodId: string;
    readonly idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ paymentMethodId: string }>>;
  listPaymentMethods(customerId: string): Promise<
    ProviderResult<
      readonly {
        id: string;
        type: string;
        last4?: string;
        reusable: boolean;
      }[]
    >
  >;
  createBankTransferInstructions(input: {
    readonly customerId: string;
    readonly currency: Money["currency"];
    readonly rail: "us_bank_transfer" | "eu_bank_transfer" | "gb_bank_transfer";
    readonly idempotencyKey: IdempotencyKey;
  }): Promise<
    ProviderResult<{
      currency: Money["currency"];
      financialAddresses: readonly Record<string, unknown>[];
    }>
  >;
  getReceipt(input: { readonly invoiceId: string }): Promise<
    ProviderResult<{
      hostedInvoiceUrl?: string;
      invoicePdf?: string;
      receiptUrl?: string;
    }>
  >;
  reportMeteredOverage(input: {
    /** Provider meter telemetry only; the commitment ledger remains billing authority. */
    readonly eventName: string;
    readonly customerId: string;
    readonly quantity: string;
    readonly occurredAt: string;
    readonly usageEventId: string;
    readonly idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ meterEventIdentifier: string }>>;
  addMeteredOverageLine(input: {
    readonly invoiceId: string;
    readonly customerId: string;
    readonly orderId: OrderId;
    readonly ledgerEntryIds: readonly string[];
    readonly sourceUsageIds: readonly string[];
    readonly sku: string;
    readonly description: string;
    readonly amount: Money;
    readonly taxCode: string;
    readonly servicePeriod: {
      readonly startsAt: string;
      readonly endsAt: string;
    };
    readonly idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ invoiceItemId: string }>>;
  issueCreditNote(input: {
    readonly invoiceId: string;
    readonly amount: Money;
    readonly reason:
      "duplicate" | "fraudulent" | "order_change" | "product_unsatisfactory";
    readonly internalReasonCode: string;
    readonly idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ creditNoteId: string; status: string }>>;
  refundPayment(input: {
    readonly paymentIntentId: string;
    readonly amount: Money;
    readonly reason: "duplicate" | "fraudulent" | "requested_by_customer";
    readonly internalReasonCode: string;
    readonly idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ refundId: string; status: string }>>;
  retrieveDispute(disputeId: string): Promise<
    ProviderResult<{
      disputeId: string;
      status: string;
      evidenceDueAt?: string;
      amount: Money;
    }>
  >;
  submitDisputeEvidence(input: {
    readonly disputeId: string;
    readonly evidence: {
      readonly customerCommunication?: string;
      readonly customerName?: string;
      readonly productDescription?: string;
      readonly uncategorizedText?: string;
    };
    readonly submit: boolean;
    readonly idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ disputeId: string; status: string }>>;
}

export interface StripeLedgerBillingPort {
  syncOverage(input: {
    readonly invoiceId: string;
    readonly providerInvoiceId: string;
    readonly orderId: OrderId;
    readonly customerId: string;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly lines: readonly {
      readonly ledgerEntryId: string;
      readonly sku: string;
      readonly taxCode: string;
      readonly quantity: string;
      readonly contractedUnitRate: Money;
      readonly amount: Money;
      readonly sourceUsageIds: readonly string[];
    }[];
    readonly idempotencyKey: IdempotencyKey;
  }): Promise<
    ProviderResult<{
      providerInvoiceItemIds: readonly string[];
      duplicateSourceUsageIds: readonly string[];
    }>
  >;
}
