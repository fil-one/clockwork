import type Stripe from "stripe";
import { describe, expect, it } from "vitest";

import {
  normalizeStripeFinancialEvent,
  normalizedStripeEventFromPayload,
} from "./webhooks";

function invoiceEvent(
  object: Record<string, unknown>,
  type = "invoice.payment_succeeded",
): Stripe.Event {
  return {
    id: "evt_invoice_totals",
    object: "event",
    api_version: "2025-12-15.clover",
    created: 1_780_000_000,
    livemode: false,
    pending_webhooks: 1,
    request: { id: "req_invoice", idempotency_key: "idem_invoice" },
    type,
    data: {
      object: {
        id: "in_partial",
        object: "invoice",
        customer: "cus_clockwork",
        currency: "usd",
        status: "open",
        ...object,
      },
    },
  } as unknown as Stripe.Event;
}

describe("normalized Stripe invoice totals", () => {
  it("carries due, paid, and remaining beside the coalesced amount", () => {
    const event = normalizeStripeFinancialEvent(
      invoiceEvent({
        amount_due: 12_000,
        amount_paid: 5_000,
        amount_remaining: 7_000,
      }),
    );
    expect(event.amount).toEqual({ currency: "USD", minor: "5000" });
    expect(event.amountDue).toEqual({ currency: "USD", minor: "12000" });
    expect(event.amountPaid).toEqual({ currency: "USD", minor: "5000" });
    expect(event.amountRemaining).toEqual({ currency: "USD", minor: "7000" });
  });

  it("keeps a settled invoice at a zero remainder", () => {
    const event = normalizeStripeFinancialEvent(
      invoiceEvent(
        { amount_due: 12_000, amount_paid: 12_000, amount_remaining: 0 },
        "invoice.paid",
      ),
    );
    expect(event.amountRemaining).toEqual({ currency: "USD", minor: "0" });
  });

  it("leaves totals off events that are not invoice events", () => {
    const intent = normalizeStripeFinancialEvent({
      id: "evt_intent",
      object: "event",
      api_version: "2025-12-15.clover",
      created: 1_780_000_000,
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_partial",
          object: "payment_intent",
          invoice: "in_partial",
          currency: "usd",
          amount: 5_000,
          status: "succeeded",
        },
      },
    } as unknown as Stripe.Event);
    expect(intent.amount).toEqual({ currency: "USD", minor: "5000" });
    expect(intent.amountDue).toBeUndefined();
    expect(intent.amountPaid).toBeUndefined();
    expect(intent.amountRemaining).toBeUndefined();
  });

  it("omits totals an invoice object does not state", () => {
    const event = normalizeStripeFinancialEvent(
      invoiceEvent({ amount_paid: 5_000 }),
    );
    expect(event.amountPaid).toEqual({ currency: "USD", minor: "5000" });
    expect(event.amountDue).toBeUndefined();
    expect(event.amountRemaining).toBeUndefined();
  });

  it("round-trips totals through a persisted inbox payload", () => {
    const event = normalizeStripeFinancialEvent(
      invoiceEvent({
        amount_due: 12_000,
        amount_paid: 5_000,
        amount_remaining: 7_000,
      }),
    );
    const persisted: unknown = JSON.parse(
      JSON.stringify({ type: event.eventType, event }),
    );
    expect(normalizedStripeEventFromPayload(persisted)).toEqual(event);
  });

  it("parses an inbox row written before invoice totals existed", () => {
    const legacy = {
      type: "invoice.paid",
      event: {
        provider: "stripe",
        eventId: "evt_legacy",
        eventType: "invoice.paid",
        category: "invoice",
        objectId: "in_legacy",
        aggregateKey: "in_legacy",
        occurredAt: "2026-05-01T00:00:00.000Z",
        livemode: false,
        customerId: "cus_clockwork",
        invoiceId: "in_legacy",
        amount: { currency: "USD", minor: "12000" },
        status: "paid",
        rawObject: { id: "in_legacy", object: "invoice" },
      },
    };
    const parsed = normalizedStripeEventFromPayload(legacy);
    expect(parsed.amount).toEqual({ currency: "USD", minor: "12000" });
    expect(parsed.amountDue).toBeUndefined();
    expect(parsed.amountPaid).toBeUndefined();
    expect(parsed.amountRemaining).toBeUndefined();
    expect(parsed).toEqual({ ...legacy.event, provider: "stripe" });
  });
});
