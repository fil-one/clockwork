import { describe, expect, it } from "vitest";

import {
  trustedSigningUrl,
  trustedStripePaymentUrl,
} from "./provider-navigation";

describe("provider navigation allow-lists", () => {
  it("accepts only HTTPS Stripe-hosted invoice URLs", () => {
    expect(
      trustedStripePaymentUrl(
        "https://invoice.stripe.com/i/acct_clockwork/test_invoice",
      ),
    ).toBe("https://invoice.stripe.com/i/acct_clockwork/test_invoice");
    expect(() =>
      trustedStripePaymentUrl("https://stripe.example.test/pay"),
    ).toThrow("untrusted payment URL");
    expect(() =>
      trustedStripePaymentUrl("http://invoice.stripe.com/pay"),
    ).toThrow("untrusted navigation URL");
  });

  it("accepts the deterministic e-sign origin in tests and denies lookalikes", () => {
    expect(
      trustedSigningUrl("https://esign.clockwork.test/embedded/envelope-1"),
    ).toBe("https://esign.clockwork.test/embedded/envelope-1");
    expect(() =>
      trustedSigningUrl(
        "https://esign.clockwork.test.attacker.example/envelope",
      ),
    ).toThrow("outside the allow-list");
    expect(() =>
      trustedSigningUrl("https://user:password@esign.clockwork.test/envelope"),
    ).toThrow("untrusted navigation URL");
  });
});
