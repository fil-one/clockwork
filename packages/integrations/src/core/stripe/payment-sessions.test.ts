import { describe, expect, it, vi } from "vitest";

import {
  StripeInvoicePaymentSessionGateway,
  type StripeInvoiceRecord,
} from "./payment-sessions";

function invoice(
  overrides: Partial<StripeInvoiceRecord> = {},
): StripeInvoiceRecord {
  return {
    id: "in_clockwork_301",
    customer: "cus_clockwork_301",
    hosted_invoice_url:
      "https://invoice.stripe.com/i/acct_clockwork/test_clockwork_301",
    status: "open",
    ...overrides,
  };
}

describe("Stripe customer payment sessions", () => {
  it("returns a trusted hosted payment URL without inventing paid status", async () => {
    const retrieve = vi.fn().mockResolvedValue(invoice());
    const gateway = new StripeInvoicePaymentSessionGateway({
      client: { invoices: { retrieve } },
    });

    await expect(
      gateway.create({
        stripeInvoiceId: "in_clockwork_301",
        stripeCustomerId: "cus_clockwork_301",
      }),
    ).resolves.toEqual({
      provider: "stripe",
      sessionId: "in_clockwork_301",
      invoiceId: "in_clockwork_301",
      url: "https://invoice.stripe.com/i/acct_clockwork/test_clockwork_301",
      status: "requires_customer_action",
    });
  });

  it("fails closed on customer mismatch, non-open invoice, or untrusted URL", async () => {
    const cases = [
      invoice({ customer: "cus_attacker" }),
      invoice({ status: "paid" }),
      invoice({ hosted_invoice_url: "https://attacker.example/pay" }),
    ];
    await Promise.all(
      cases.map(async (value) => {
        const gateway = new StripeInvoicePaymentSessionGateway({
          client: {
            invoices: { retrieve: vi.fn().mockResolvedValue(value) },
          },
        });
        await expect(
          gateway.create({
            stripeInvoiceId: "in_clockwork_301",
            stripeCustomerId: "cus_clockwork_301",
          }),
        ).rejects.toThrow();
      }),
    );
  });
});
