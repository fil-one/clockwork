import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import {
  InMemoryStripeWebhookInbox,
  ReplaySafeStripeWebhookProcessor,
  StripeFinancialWebhookVerifier,
  StripeWebhookPayloadConflictError,
} from "./webhooks";

const secret = "whsec_clockwork_core_finance_fixture";
const encoder = new TextEncoder();

function eventPayload(input: {
  id: string;
  created: number;
  status: string;
  amount?: number;
}): string {
  return JSON.stringify({
    id: input.id,
    object: "event",
    api_version: "2025-12-15.clover",
    created: input.created,
    livemode: false,
    pending_webhooks: 1,
    request: { id: `req_${input.id}`, idempotency_key: `idem_${input.id}` },
    type: input.status === "paid" ? "invoice.paid" : "invoice.payment_failed",
    data: {
      object: {
        id: "in_same_aggregate",
        object: "invoice",
        customer: "cus_clockwork",
        currency: "usd",
        amount_paid: input.amount ?? 12_500,
        status: input.status,
      },
    },
  });
}

function signed(payload: string): string {
  return Stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
    timestamp: Math.floor(Date.now() / 1000),
  });
}

describe("replay-safe Stripe financial webhooks", () => {
  it("verifies raw bytes, deduplicates, labels late delivery, and supports audited replay", async () => {
    const stripe = new Stripe("sk_test_clockwork_fixture");
    const processor = new ReplaySafeStripeWebhookProcessor(
      new StripeFinancialWebhookVerifier(secret, { client: stripe }),
      new InMemoryStripeWebhookInbox(),
    );
    const handler = vi.fn(async () => Promise.resolve());
    const current = eventPayload({
      id: "evt_current",
      created: 2_000,
      status: "paid",
    });
    const first = await processor.process({
      rawBody: encoder.encode(current),
      signature: signed(current),
      handler,
    });
    expect(first).toMatchObject({
      disposition: "processed",
      ordering: "current",
    });

    const duplicate = await processor.process({
      rawBody: encoder.encode(current),
      signature: signed(current),
      handler,
    });
    expect(duplicate.disposition).toBe("duplicate");
    expect(handler).toHaveBeenCalledTimes(1);

    const late = eventPayload({
      id: "evt_late",
      created: 1_000,
      status: "failed",
    });
    const lateResult = await processor.process({
      rawBody: encoder.encode(late),
      signature: signed(late),
      handler,
    });
    expect(lateResult).toMatchObject({
      disposition: "processed",
      ordering: "out_of_order",
    });

    const replayed = await processor.process({
      rawBody: encoder.encode(current),
      signature: signed(current),
      handler,
      replay: {
        reason: "rebuild invoice projection",
        actorId: "finance_operator_1",
      },
    });
    expect(replayed).toMatchObject({
      disposition: "processed",
      ordering: "current",
    });
    expect(handler).toHaveBeenLastCalledWith(
      expect.objectContaining({ delivery: "operator_replay" }),
    );
  });

  it("rejects a signed event ID reused with different bytes", async () => {
    const stripe = new Stripe("sk_test_clockwork_fixture");
    const processor = new ReplaySafeStripeWebhookProcessor(
      new StripeFinancialWebhookVerifier(secret, { client: stripe }),
      new InMemoryStripeWebhookInbox(),
    );
    const original = eventPayload({
      id: "evt_collision",
      created: 2_000,
      status: "paid",
    });
    await processor.process({
      rawBody: encoder.encode(original),
      signature: signed(original),
      handler: async () => Promise.resolve(),
    });
    const altered = eventPayload({
      id: "evt_collision",
      created: 2_000,
      status: "paid",
      amount: 99_999,
    });
    await expect(
      processor.process({
        rawBody: encoder.encode(altered),
        signature: signed(altered),
        handler: async () => Promise.resolve(),
      }),
    ).rejects.toBeInstanceOf(StripeWebhookPayloadConflictError);
  });

  it("never claims a body whose signature does not match its raw bytes", async () => {
    const inbox = new InMemoryStripeWebhookInbox();
    const claim = vi.spyOn(inbox, "claim");
    const processor = new ReplaySafeStripeWebhookProcessor(
      new StripeFinancialWebhookVerifier(secret, {
        client: new Stripe("sk_test_clockwork_fixture"),
      }),
      inbox,
    );
    const payload = eventPayload({
      id: "evt_bad_signature",
      created: 2_000,
      status: "paid",
    });
    await expect(
      processor.process({
        rawBody: encoder.encode(`${payload} `),
        signature: signed(payload),
        handler: async () => Promise.resolve(),
      }),
    ).rejects.toThrow();
    expect(claim).not.toHaveBeenCalled();
  });
});
