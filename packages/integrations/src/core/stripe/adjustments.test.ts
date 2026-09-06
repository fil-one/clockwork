import { IdempotencyKeySchema, MoneySchema } from "@clockwork/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  InMemoryPersistedStripeAdjustmentStore,
  PersistedStripeAdjustmentSubmitter,
  type PersistedStripeAdjustmentOperation,
  type PersistedStripeAdjustmentStore,
} from "./adjustments";
import type { StripeCommercialGateway } from "./types";

const operation = (
  adjustmentId: string,
  overrides: Partial<PersistedStripeAdjustmentOperation> = {},
): PersistedStripeAdjustmentOperation => ({
  adjustmentId,
  expectedVersion: 2,
  orderId: "10000000-0000-4000-8000-000000000001",
  sourceId: "20000000-0000-4000-8000-000000000001",
  sourceCurrency: "USD",
  kind: "refund",
  providerPaymentIntentId: "pi_from_persisted_payment",
  amount: MoneySchema.parse({ currency: "USD", minor: "2500" }),
  individualCapMinor: "5000",
  aggregateCapMinor: "10000",
  alreadyAdjustedMinor: "1000",
  reason: "requested_by_customer",
  internalReasonCode: "approved_customer_refund",
  providerIdempotencyKey: IdempotencyKeySchema.parse(
    `stripe-adjustment:${adjustmentId}`,
  ),
  ...overrides,
});

function gateway(input?: {
  refund?: Pick<StripeCommercialGateway, "refundPayment">["refundPayment"];
}): Pick<StripeCommercialGateway, "issueCreditNote" | "refundPayment"> {
  return {
    issueCreditNote: vi.fn().mockResolvedValue({
      ok: true,
      value: { creditNoteId: "cn_provider", status: "issued" },
    }),
    refundPayment:
      input?.refund ??
      vi.fn().mockResolvedValue({
        ok: true,
        value: { refundId: "re_provider", status: "pending" },
      }),
  };
}

describe("persisted Stripe adjustment submission", () => {
  it("reserves PAYG credit and refund capacity against their common invoice without a term order", async () => {
    const common = {
      orderId: null,
      invoiceId: "payg-invoice",
      aggregateCapMinor: "4000",
      alreadyAdjustedMinor: "0",
    };
    const store = new InMemoryPersistedStripeAdjustmentStore([
      operation("payg-credit", {
        ...common,
        kind: "credit_note",
        sourceId: "payg-invoice",
        providerInvoiceId: "in_payg",
      }),
      operation("payg-refund", { ...common, sourceId: "payg-payment" }),
      operation("other-refund", {
        ...common,
        invoiceId: "other-payg-invoice",
        sourceId: "other-payment",
      }),
    ]);
    expect(
      (await store.claim({ adjustmentId: "payg-credit", expectedVersion: 2 }))
        .status,
    ).toBe("claimed");
    expect(
      (await store.claim({ adjustmentId: "payg-refund", expectedVersion: 2 }))
        .status,
    ).toBe("cap_exceeded");
    expect(
      (await store.claim({ adjustmentId: "other-refund", expectedVersion: 2 }))
        .status,
    ).toBe("claimed");
  });

  it("derives every refund field from persisted state and does not claim final success", async () => {
    const refundPayment = vi.fn().mockResolvedValue({
      ok: true,
      value: { refundId: "re_provider", status: "pending" },
    });
    const persisted = operation("adjustment_1");
    const submitter = new PersistedStripeAdjustmentSubmitter(
      new InMemoryPersistedStripeAdjustmentStore([persisted]),
      gateway({ refund: refundPayment }),
    );

    const result = await submitter.submit({
      adjustmentId: "adjustment_1",
      expectedVersion: 2,
    });

    expect(refundPayment).toHaveBeenCalledWith({
      paymentIntentId: "pi_from_persisted_payment",
      amount: { currency: "USD", minor: "2500" },
      reason: "requested_by_customer",
      internalReasonCode: "approved_customer_refund",
      idempotencyKey: "stripe-adjustment:adjustment_1",
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "provider_accepted",
        providerObjectId: "re_provider",
        providerStatus: "pending",
      },
    });
    await expect(
      submitter.submit({ adjustmentId: "adjustment_1", expectedVersion: 2 }),
    ).resolves.toMatchObject({ ok: true, duplicate: true });
    expect(refundPayment).toHaveBeenCalledTimes(1);
  });

  it("derives a credit note invoice, amount, currency, and reason from its persisted command", async () => {
    const issueCreditNote = vi.fn().mockResolvedValue({
      ok: true,
      value: { creditNoteId: "cn_provider", status: "issued" },
    });
    const provider = gateway();
    provider.issueCreditNote = issueCreditNote;
    const submitter = new PersistedStripeAdjustmentSubmitter(
      new InMemoryPersistedStripeAdjustmentStore([
        operation("credit_1", {
          kind: "credit_note",
          providerInvoiceId: "in_from_persisted_invoice",
          reason: "order_change",
          internalReasonCode: "approved_order_correction",
        }),
      ]),
      provider,
    );
    await expect(
      submitter.submit({ adjustmentId: "credit_1", expectedVersion: 2 }),
    ).resolves.toMatchObject({
      ok: true,
      value: { providerObjectId: "cn_provider", providerStatus: "issued" },
    });
    expect(issueCreditNote).toHaveBeenCalledWith({
      invoiceId: "in_from_persisted_invoice",
      amount: { currency: "USD", minor: "2500" },
      reason: "order_change",
      internalReasonCode: "approved_order_correction",
      idempotencyKey: "stripe-adjustment:credit_1",
    });
  });

  it("reserves aggregate capacity atomically so concurrent over-refunds fail closed", async () => {
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const refundPayment = vi.fn(async () => {
      await providerGate;
      return {
        ok: true as const,
        value: { refundId: "re_provider_1", status: "pending" },
      };
    });
    const first = operation("adjustment_1", {
      amount: MoneySchema.parse({ currency: "USD", minor: "6000" }),
      individualCapMinor: "6000",
      aggregateCapMinor: "10000",
      alreadyAdjustedMinor: "0",
    });
    const second = operation("adjustment_2", {
      amount: MoneySchema.parse({ currency: "USD", minor: "6000" }),
      individualCapMinor: "6000",
      aggregateCapMinor: "10000",
      alreadyAdjustedMinor: "0",
    });
    const submitter = new PersistedStripeAdjustmentSubmitter(
      new InMemoryPersistedStripeAdjustmentStore([first, second]),
      gateway({ refund: refundPayment }),
    );

    const firstRun = submitter.submit({
      adjustmentId: "adjustment_1",
      expectedVersion: 2,
    });
    await Promise.resolve();
    const secondRun = await submitter.submit({
      adjustmentId: "adjustment_2",
      expectedVersion: 2,
    });
    expect(secondRun).toMatchObject({
      ok: false,
      code: "STRIPE_ADJUSTMENT_CAP_EXCEEDED",
    });
    releaseProvider();
    await expect(firstRun).resolves.toMatchObject({ ok: true });
    expect(refundPayment).toHaveBeenCalledTimes(1);
  });

  it("replays the same provider key after a crash following provider success", async () => {
    const backing = new InMemoryPersistedStripeAdjustmentStore([
      operation("adjustment_crash"),
    ]);
    let crash = true;
    const store: PersistedStripeAdjustmentStore = {
      claim: (input) => backing.claim(input),
      recordProviderAcceptance: async (input) => {
        if (crash) {
          crash = false;
          throw new Error("simulated crash after Stripe accepted");
        }
        await backing.recordProviderAcceptance(input);
      },
      recordRetrying: (input) => backing.recordRetrying(input),
      recordProviderRejection: (input) =>
        backing.recordProviderRejection(input),
    };
    const refundPayment = vi
      .fn<StripeCommercialGateway["refundPayment"]>()
      .mockResolvedValueOnce({
        ok: true,
        value: { refundId: "re_after_crash", status: "pending" },
      })
      .mockResolvedValueOnce({
        ok: true,
        duplicate: true,
        value: { refundId: "re_after_crash", status: "pending" },
      });
    const submitter = new PersistedStripeAdjustmentSubmitter(
      store,
      gateway({ refund: refundPayment }),
    );

    await expect(
      submitter.submit({
        adjustmentId: "adjustment_crash",
        expectedVersion: 2,
      }),
    ).resolves.toMatchObject({
      ok: false,
      kind: "transient",
      code: "CRASH_AFTER_PROVIDER_ACCEPTANCE",
    });
    await expect(
      submitter.submit({
        adjustmentId: "adjustment_crash",
        expectedVersion: 2,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { providerObjectId: "re_after_crash", duplicate: true },
    });
    expect(refundPayment).toHaveBeenCalledTimes(2);
    expect(refundPayment.mock.calls[0]?.[0].idempotencyKey).toBe(
      refundPayment.mock.calls[1]?.[0].idempotencyKey,
    );
  });

  it("turns a provider timeout into a retryable claim without changing persisted truth", async () => {
    const refundPayment = vi
      .fn<StripeCommercialGateway["refundPayment"]>()
      .mockRejectedValueOnce({ type: "TimeoutError", code: "ETIMEDOUT" })
      .mockResolvedValueOnce({
        ok: true,
        value: { refundId: "re_after_timeout", status: "pending" },
      });
    const submitter = new PersistedStripeAdjustmentSubmitter(
      new InMemoryPersistedStripeAdjustmentStore([
        operation("adjustment_timeout"),
      ]),
      gateway({ refund: refundPayment }),
    );
    await expect(
      submitter.submit({
        adjustmentId: "adjustment_timeout",
        expectedVersion: 2,
      }),
    ).resolves.toMatchObject({
      ok: false,
      kind: "transient",
      code: "ETIMEDOUT",
    });
    await expect(
      submitter.submit({
        adjustmentId: "adjustment_timeout",
        expectedVersion: 2,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: "provider_accepted",
        providerObjectId: "re_after_timeout",
      },
    });
    expect(refundPayment.mock.calls[0]?.[0].idempotencyKey).toBe(
      refundPayment.mock.calls[1]?.[0].idempotencyKey,
    );
  });

  it("rejects stale commands and persisted source currency mismatches before Stripe", async () => {
    const provider = gateway();
    const submitter = new PersistedStripeAdjustmentSubmitter(
      new InMemoryPersistedStripeAdjustmentStore([
        operation("adjustment_bad_currency", { sourceCurrency: "EUR" }),
      ]),
      provider,
    );
    await expect(
      submitter.submit({
        adjustmentId: "adjustment_bad_currency",
        expectedVersion: 1,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "STRIPE_ADJUSTMENT_STALE",
    });
    await expect(
      submitter.submit({
        adjustmentId: "adjustment_bad_currency",
        expectedVersion: 2,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "STRIPE_ADJUSTMENT_CAP_EXCEEDED",
    });
    expect(provider.refundPayment).not.toHaveBeenCalled();
  });
});
