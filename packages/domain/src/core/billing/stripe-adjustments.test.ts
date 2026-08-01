import { MoneySchema } from "@clockwork/contracts";
import { describe, expect, it } from "vitest";

import {
  projectStripeAdjustmentTruth,
  type PersistedStripeAdjustment,
  type StripeFinancialEvent,
} from "./index";

const refund = (
  adjustmentId: string,
  providerObjectId: string,
): PersistedStripeAdjustment => ({
  adjustmentId,
  kind: "refund",
  providerObjectId,
  sourceObjectId: "pi_persisted",
  amount: MoneySchema.parse({ currency: "USD", minor: "2500" }),
  status: "pending",
});

const event = (
  id: string,
  objectId: string,
  created: number,
  status: string,
  overrides: Partial<StripeFinancialEvent> = {},
): StripeFinancialEvent => ({
  id,
  type: "refund.updated",
  objectId,
  created,
  status,
  amountMinor: "2500",
  currency: "USD",
  paymentIntentId: "pi_persisted",
  ...overrides,
});

describe("persisted Stripe adjustment projection", () => {
  it("ignores refund.created and derives pending to succeeded only from signed update events", () => {
    const result = projectStripeAdjustmentTruth({
      adjustments: [refund("local_refund_1", "re_persisted_1")],
      events: [
        event("evt_created", "re_persisted_1", 1, "succeeded", {
          type: "refund.created",
        }),
        event("evt_pending", "re_persisted_1", 2, "pending"),
        event("evt_succeeded", "re_persisted_1", 3, "succeeded"),
      ],
    });
    expect(result.ignored).toEqual(["evt_created"]);
    expect(result.projections.local_refund_1).toMatchObject({
      status: "succeeded",
      watermark: { eventId: "evt_succeeded", created: 3 },
    });
  });

  it("uses an independent watermark for each refund sharing one payment intent", () => {
    const result = projectStripeAdjustmentTruth({
      adjustments: [
        refund("local_refund_1", "re_persisted_1"),
        refund("local_refund_2", "re_persisted_2"),
      ],
      events: [
        event("evt_second_new", "re_persisted_2", 20, "succeeded"),
        event("evt_first_old", "re_persisted_1", 10, "failed"),
      ],
    });
    expect(result.projections.local_refund_1?.status).toBe("failed");
    expect(result.projections.local_refund_2?.status).toBe("succeeded");
    expect(result.ignored).toEqual([]);
  });

  it("rejects forged provider IDs, source bindings, amount, and currency", () => {
    const result = projectStripeAdjustmentTruth({
      adjustments: [refund("local_refund_1", "re_persisted_1")],
      events: [
        event("evt_forged_id", "re_attacker", 1, "succeeded"),
        event("evt_forged_payment", "re_persisted_1", 2, "succeeded", {
          paymentIntentId: "pi_attacker",
        }),
        event("evt_over_refund", "re_persisted_1", 3, "succeeded", {
          amountMinor: "2501",
        }),
        event("evt_wrong_currency", "re_persisted_1", 4, "succeeded", {
          currency: "EUR",
        }),
      ],
    });
    expect(result.rejected).toEqual([
      { eventId: "evt_forged_id", reason: "provider_object_unbound" },
      { eventId: "evt_forged_payment", reason: "source_binding_mismatch" },
      { eventId: "evt_over_refund", reason: "money_binding_mismatch" },
      { eventId: "evt_wrong_currency", reason: "money_binding_mismatch" },
    ]);
    expect(result.projections.local_refund_1?.status).toBe("pending");
  });

  it("handles duplicate, reordered, pending to failed, and terminal conflicts", () => {
    const failed = event("evt_failed", "re_persisted_1", 20, "failed");
    const result = projectStripeAdjustmentTruth({
      adjustments: [refund("local_refund_1", "re_persisted_1")],
      events: [
        event("evt_pending", "re_persisted_1", 10, "pending"),
        failed,
        failed,
        event("evt_reordered", "re_persisted_1", 15, "pending"),
        event("evt_conflict", "re_persisted_1", 30, "succeeded"),
      ],
    });
    expect(result.projections.local_refund_1).toMatchObject({
      status: "failed",
      watermark: { eventId: "evt_failed", created: 20 },
    });
    expect(result.duplicates).toEqual(["evt_failed"]);
    expect(result.ignored).toEqual(["evt_reordered"]);
    expect(result.rejected).toContainEqual({
      eventId: "evt_conflict",
      reason: "terminal_status_conflict",
    });
  });

  it("binds credit-note success to the persisted invoice and money", () => {
    const result = projectStripeAdjustmentTruth({
      adjustments: [
        {
          adjustmentId: "local_credit_1",
          kind: "credit_note",
          providerObjectId: "cn_persisted",
          sourceObjectId: "in_persisted",
          amount: MoneySchema.parse({ currency: "GBP", minor: "900" }),
          status: "pending",
        },
      ],
      events: [
        {
          id: "evt_credit_issued",
          type: "credit_note.created",
          created: 10,
          objectId: "cn_persisted",
          status: "issued",
          amountMinor: "900",
          currency: "GBP",
          invoiceId: "in_persisted",
        },
      ],
    });
    expect(result.projections.local_credit_1?.status).toBe("succeeded");
    expect(result.rejected).toEqual([]);
  });
});
