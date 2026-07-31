import { StripeWebhookVerifier } from "@clockwork/integrations";
import { describe, expect, it } from "vitest";

import {
  signStripeWebhook,
  stripeWebhookFixture,
  stripeWebhookSecret,
} from "./fixtures";

describe("Stripe webhook fixture", () => {
  it("passes the production verifier with the default current signature", async () => {
    const payload = stripeWebhookFixture({
      id: "evt_clockwork_fixture",
      type: "invoice.paid",
      data: { id: "in_clockwork_fixture" },
    });
    const result = await new StripeWebhookVerifier(stripeWebhookSecret).verify({
      rawBody: new TextEncoder().encode(payload),
      signature: signStripeWebhook(payload),
    });
    expect(result.eventId).toBe("evt_clockwork_fixture");
  });
});
