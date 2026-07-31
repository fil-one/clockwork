import Stripe from "stripe";

export const stripeWebhookSecret =
  "whsec_clockwork_test_fixture_not_a_real_secret";

export function stripeWebhookFixture(input: {
  id: string;
  type: string;
  data: Record<string, unknown>;
  created?: number;
}) {
  return JSON.stringify({
    id: input.id,
    object: "event",
    api_version: "2025-12-15.clover",
    created: input.created ?? 1_785_513_600,
    livemode: false,
    pending_webhooks: 1,
    request: { id: `req_${input.id}`, idempotency_key: `idem_${input.id}` },
    type: input.type,
    data: { object: input.data },
  });
}

export function signStripeWebhook(
  payload: string,
  secret = stripeWebhookSecret,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  return Stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
    timestamp,
  });
}

export class DeterministicStripeTestClock {
  public constructor(public frozenTime = 1_785_513_600) {}
  public advance(seconds: number) {
    if (!Number.isSafeInteger(seconds) || seconds < 0)
      throw new Error(
        "Stripe test clock only advances by non-negative integer seconds",
      );
    this.frozenTime += seconds;
    return this.frozenTime;
  }
  public fixture() {
    return {
      id: "clock_clockwork_demo",
      object: "test_helpers.test_clock",
      frozen_time: this.frozenTime,
      status: "ready" as const,
    };
  }
}
