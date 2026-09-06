import { randomUUID } from "node:crypto";

import type {
  Currency,
  IdempotencyKey,
  Money,
  ProviderResult,
} from "@clockwork/contracts";

import { toProviderFailure } from "../provider-result";
import type { StripeCommercialGateway } from "./types";

export interface PersistedStripeAdjustmentOperation {
  readonly adjustmentId: string;
  readonly expectedVersion: number;
  readonly orderId: string | null;
  readonly invoiceId?: string;
  readonly sourceId: string;
  readonly sourceCurrency: Currency;
  readonly kind: "credit_note" | "refund";
  readonly providerInvoiceId?: string;
  readonly providerPaymentIntentId?: string;
  readonly amount: Money;
  readonly individualCapMinor: string;
  readonly aggregateCapMinor: string;
  readonly alreadyAdjustedMinor: string;
  readonly reason:
    | "duplicate"
    | "fraudulent"
    | "order_change"
    | "product_unsatisfactory"
    | "requested_by_customer";
  readonly internalReasonCode: string;
  readonly providerIdempotencyKey: IdempotencyKey;
}

export type StripeAdjustmentClaim =
  | {
      readonly status: "claimed";
      readonly leaseToken: string;
      readonly operation: PersistedStripeAdjustmentOperation;
    }
  | { readonly status: "in_progress" }
  | {
      readonly status: "provider_accepted";
      readonly providerObjectId: string;
      readonly providerStatus: string;
    }
  | { readonly status: "stale" | "not_approved" | "cap_exceeded" };

export interface PersistedStripeAdjustmentStore {
  /**
   * Production implementations claim and reserve aggregate capacity in one
   * transaction after locking the source invoice/payment and order identity.
   */
  claim(input: {
    readonly adjustmentId: string;
    readonly expectedVersion: number;
  }): Promise<StripeAdjustmentClaim>;
  recordProviderAcceptance(input: {
    readonly adjustmentId: string;
    readonly leaseToken: string;
    readonly providerObjectId: string;
    readonly providerStatus: string;
  }): Promise<void>;
  recordRetrying(input: {
    readonly adjustmentId: string;
    readonly leaseToken: string;
    readonly code: string;
  }): Promise<void>;
  recordProviderRejection(input: {
    readonly adjustmentId: string;
    readonly leaseToken: string;
    readonly code: string;
  }): Promise<void>;
}

export type StripeAdjustmentSubmission =
  | {
      readonly status: "provider_accepted";
      readonly duplicate: boolean;
      readonly providerObjectId: string;
      readonly providerStatus: string;
    }
  | { readonly status: "in_progress" };

function permanent(code: string, message: string): ProviderResult<never> {
  return { ok: false, kind: "permanent", code, message };
}

/**
 * Submits only a local adjustment identity/version. Provider identifiers,
 * order/source binding, amount, currency, reasons, caps, and idempotency are
 * loaded from the store's authoritative claim.
 */
export class PersistedStripeAdjustmentSubmitter {
  public constructor(
    private readonly store: PersistedStripeAdjustmentStore,
    private readonly stripe: Pick<
      StripeCommercialGateway,
      "issueCreditNote" | "refundPayment"
    >,
  ) {}

  public async submit(input: {
    readonly adjustmentId: string;
    readonly expectedVersion: number;
  }): Promise<ProviderResult<StripeAdjustmentSubmission>> {
    let claim: StripeAdjustmentClaim;
    try {
      claim = await this.store.claim(input);
    } catch {
      return {
        ok: false,
        kind: "transient",
        code: "STRIPE_ADJUSTMENT_STORE_UNAVAILABLE",
        message: "Persisted Stripe adjustment state is temporarily unavailable",
      };
    }
    if (claim.status === "in_progress")
      return { ok: true, value: { status: "in_progress" } };
    if (claim.status === "provider_accepted")
      return {
        ok: true,
        duplicate: true,
        value: {
          status: "provider_accepted",
          duplicate: true,
          providerObjectId: claim.providerObjectId,
          providerStatus: claim.providerStatus,
        },
      };
    if (claim.status !== "claimed")
      return permanent(
        `STRIPE_ADJUSTMENT_${claim.status.toUpperCase()}`,
        "The persisted adjustment is not eligible for provider submission",
      );

    const operation = claim.operation;
    let result: Awaited<
      ReturnType<
        | StripeCommercialGateway["issueCreditNote"]
        | StripeCommercialGateway["refundPayment"]
      >
    >;
    try {
      if (operation.kind === "credit_note") {
        if (!operation.providerInvoiceId)
          return this.rejectInvalidBinding(
            claim,
            "CREDIT_NOTE_INVOICE_UNBOUND",
          );
        if (
          operation.reason !== "duplicate" &&
          operation.reason !== "fraudulent" &&
          operation.reason !== "order_change" &&
          operation.reason !== "product_unsatisfactory"
        )
          return this.rejectInvalidBinding(claim, "CREDIT_NOTE_REASON_INVALID");
        result = await this.stripe.issueCreditNote({
          invoiceId: operation.providerInvoiceId,
          amount: operation.amount,
          reason: operation.reason,
          internalReasonCode: operation.internalReasonCode,
          idempotencyKey: operation.providerIdempotencyKey,
        });
      } else {
        if (!operation.providerPaymentIntentId)
          return this.rejectInvalidBinding(claim, "REFUND_PAYMENT_UNBOUND");
        if (
          operation.reason !== "duplicate" &&
          operation.reason !== "fraudulent" &&
          operation.reason !== "requested_by_customer"
        )
          return this.rejectInvalidBinding(claim, "REFUND_REASON_INVALID");
        result = await this.stripe.refundPayment({
          paymentIntentId: operation.providerPaymentIntentId,
          amount: operation.amount,
          reason: operation.reason,
          internalReasonCode: operation.internalReasonCode,
          idempotencyKey: operation.providerIdempotencyKey,
        });
      }
    } catch (error) {
      result = toProviderFailure(error);
    }
    if (!result.ok) {
      try {
        if (result.kind === "transient")
          await this.store.recordRetrying({
            adjustmentId: operation.adjustmentId,
            leaseToken: claim.leaseToken,
            code: result.code,
          });
        else
          await this.store.recordProviderRejection({
            adjustmentId: operation.adjustmentId,
            leaseToken: claim.leaseToken,
            code: result.code,
          });
      } catch {
        return {
          ok: false,
          kind: "transient",
          code: "STRIPE_ADJUSTMENT_STORE_UNAVAILABLE",
          message: "Provider outcome could not be durably recorded",
        };
      }
      return result;
    }
    const providerObjectId =
      operation.kind === "credit_note"
        ? "creditNoteId" in result.value
          ? result.value.creditNoteId
          : undefined
        : "refundId" in result.value
          ? result.value.refundId
          : undefined;
    if (!providerObjectId)
      return this.rejectInvalidBinding(claim, "PROVIDER_OBJECT_ID_MISSING");
    try {
      await this.store.recordProviderAcceptance({
        adjustmentId: operation.adjustmentId,
        leaseToken: claim.leaseToken,
        providerObjectId,
        providerStatus: result.value.status,
      });
    } catch {
      try {
        await this.store.recordRetrying({
          adjustmentId: operation.adjustmentId,
          leaseToken: claim.leaseToken,
          code: "CRASH_AFTER_PROVIDER_ACCEPTANCE",
        });
      } catch {
        // The provider idempotency key is persisted, so retry remains safe even
        // when both local writes are unavailable after provider acceptance.
      }
      return {
        ok: false,
        kind: "transient",
        code: "CRASH_AFTER_PROVIDER_ACCEPTANCE",
        message: "Provider acceptance awaits durable local recording",
      };
    }
    return {
      ok: true,
      value: {
        status: "provider_accepted",
        duplicate: result.duplicate === true,
        providerObjectId,
        providerStatus: result.value.status,
      },
    };
  }

  private async rejectInvalidBinding(
    claim: Extract<StripeAdjustmentClaim, { status: "claimed" }>,
    code: string,
  ): Promise<ProviderResult<never>> {
    try {
      await this.store.recordProviderRejection({
        adjustmentId: claim.operation.adjustmentId,
        leaseToken: claim.leaseToken,
        code,
      });
    } catch {
      return {
        ok: false,
        kind: "transient",
        code: "STRIPE_ADJUSTMENT_STORE_UNAVAILABLE",
        message: "Invalid persisted binding could not be recorded",
      };
    }
    return permanent(
      code,
      "The persisted Stripe adjustment binding is invalid",
    );
  }
}

type MemoryAdjustment = {
  operation: PersistedStripeAdjustmentOperation;
  state:
    "approved" | "submitting" | "retrying" | "provider_accepted" | "rejected";
  leaseToken?: string;
  providerObjectId?: string;
  providerStatus?: string;
};

/** Deterministic simulator with atomic aggregate-cap reservations. */
export class InMemoryPersistedStripeAdjustmentStore implements PersistedStripeAdjustmentStore {
  private readonly rows = new Map<string, MemoryAdjustment>();

  public constructor(
    operations: readonly PersistedStripeAdjustmentOperation[],
  ) {
    for (const operation of operations) {
      if (this.rows.has(operation.adjustmentId))
        throw new Error("Duplicate Stripe adjustment identity");
      this.rows.set(operation.adjustmentId, { operation, state: "approved" });
    }
  }

  public claim(input: {
    adjustmentId: string;
    expectedVersion: number;
  }): Promise<StripeAdjustmentClaim> {
    const row = this.rows.get(input.adjustmentId);
    if (!row || row.state === "rejected")
      return Promise.resolve({ status: "not_approved" });
    if (row.operation.expectedVersion !== input.expectedVersion)
      return Promise.resolve({ status: "stale" });
    if (row.state === "submitting")
      return Promise.resolve({ status: "in_progress" });
    if (
      row.state === "provider_accepted" &&
      row.providerObjectId &&
      row.providerStatus
    )
      return Promise.resolve({
        status: "provider_accepted",
        providerObjectId: row.providerObjectId,
        providerStatus: row.providerStatus,
      });
    const operation = row.operation;
    const amount = BigInt(operation.amount.minor);
    if (
      (!operation.orderId && !operation.invoiceId) ||
      !operation.sourceId ||
      operation.amount.currency !== operation.sourceCurrency ||
      amount <= 0n ||
      amount > BigInt(operation.individualCapMinor)
    ) {
      row.state = "rejected";
      return Promise.resolve({ status: "cap_exceeded" });
    }
    const reserved = [...this.rows.values()]
      .filter(
        (candidate) =>
          candidate !== row &&
          (operation.orderId
            ? candidate.operation.orderId === operation.orderId
            : candidate.operation.invoiceId === operation.invoiceId) &&
          candidate.operation.sourceCurrency === operation.sourceCurrency &&
          (candidate.state === "submitting" ||
            candidate.state === "provider_accepted"),
      )
      .reduce(
        (sum, candidate) => sum + BigInt(candidate.operation.amount.minor),
        0n,
      );
    if (
      BigInt(operation.alreadyAdjustedMinor) + reserved + amount >
      BigInt(operation.aggregateCapMinor)
    ) {
      row.state = "rejected";
      return Promise.resolve({ status: "cap_exceeded" });
    }
    const leaseToken = randomUUID();
    row.state = "submitting";
    row.leaseToken = leaseToken;
    return Promise.resolve({ status: "claimed", leaseToken, operation });
  }

  public recordProviderAcceptance(input: {
    adjustmentId: string;
    leaseToken: string;
    providerObjectId: string;
    providerStatus: string;
  }): Promise<void> {
    const row = this.requireLease(input.adjustmentId, input.leaseToken);
    row.state = "provider_accepted";
    row.providerObjectId = input.providerObjectId;
    row.providerStatus = input.providerStatus;
    delete row.leaseToken;
    return Promise.resolve();
  }

  public recordRetrying(input: {
    adjustmentId: string;
    leaseToken: string;
    code: string;
  }): Promise<void> {
    const row = this.requireLease(input.adjustmentId, input.leaseToken);
    row.state = "retrying";
    delete row.leaseToken;
    return Promise.resolve();
  }

  public recordProviderRejection(input: {
    adjustmentId: string;
    leaseToken: string;
    code: string;
  }): Promise<void> {
    const row = this.requireLease(input.adjustmentId, input.leaseToken);
    row.state = "rejected";
    delete row.leaseToken;
    return Promise.resolve();
  }

  private requireLease(
    adjustmentId: string,
    leaseToken: string,
  ): MemoryAdjustment {
    const row = this.rows.get(adjustmentId);
    if (!row || row.state !== "submitting" || row.leaseToken !== leaseToken)
      throw new Error("STALE_STRIPE_ADJUSTMENT_LEASE");
    return row;
  }
}
