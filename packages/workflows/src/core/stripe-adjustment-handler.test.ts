import { describe, expect, it, vi } from "vitest";

import { createStripeAdjustmentOutboxHandlersWithSubmitter } from "./stripe-adjustment-handler";

function delivery(eventType = "core.refunds.submit", aggregateType = "refund") {
  return {
    messageId: "40000000-0000-4000-8000-000000000001",
    eventId: "50000000-0000-4000-8000-000000000001",
    topic: eventType,
    idempotencyKey: "outbox:refund",
    payload: {
      eventType,
      aggregateType,
      aggregateId: "60000000-0000-4000-8000-000000000001",
      aggregateVersion: 3,
    },
  };
}

describe("Stripe adjustment outbox boundary", () => {
  it("submits only persisted identity and version on duplicate delivery", async () => {
    const submit = vi.fn().mockResolvedValue({
      ok: true,
      duplicate: true,
      value: {
        status: "provider_accepted",
        duplicate: true,
        providerObjectId: "re_bound",
        providerStatus: "pending",
      },
    });
    const handlers = createStripeAdjustmentOutboxHandlersWithSubmitter({
      submitter: { submit },
    });
    const handler = handlers.get("core.refunds.submit");
    if (!handler) throw new Error("refund handler missing");

    await handler(delivery());
    await handler(delivery());

    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenNthCalledWith(1, {
      adjustmentId: "60000000-0000-4000-8000-000000000001",
      expectedVersion: 3,
    });
    expect(submit.mock.calls[0]).toEqual(submit.mock.calls[1]);
  });

  it("rejects forged event/aggregate bindings before provider submission", async () => {
    const submit = vi.fn();
    const handlers = createStripeAdjustmentOutboxHandlersWithSubmitter({
      submitter: { submit },
    });
    const handler = handlers.get("core.refunds.submit");
    if (!handler) throw new Error("refund handler missing");

    await expect(
      handler(delivery("core.refunds.submit", "credit_note")),
    ).rejects.toThrow();
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps provider timeouts retryable", async () => {
    const submit = vi.fn().mockResolvedValue({
      ok: false,
      kind: "transient",
      code: "ETIMEDOUT",
      message: "provider timeout",
    });
    const handlers = createStripeAdjustmentOutboxHandlersWithSubmitter({
      submitter: { submit },
    });
    const handler = handlers.get("core.refunds.submit");
    if (!handler) throw new Error("refund handler missing");

    await expect(handler(delivery())).rejects.toThrow("ETIMEDOUT");
  });
});
