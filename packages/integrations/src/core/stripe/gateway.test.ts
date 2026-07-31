import { IdempotencyKeySchema, ids, MoneySchema } from "@clockwork/contracts";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { StripeFinanceGateway } from "./gateway";

const orderId = ids.order.parse("00000000-0000-4000-8000-000000000201");
const endClientId = ids.account.parse("00000000-0000-4000-8000-000000000101");
const idempotencyKey = IdempotencyKeySchema.parse("order:201:invoice:v1");

function stripeClientFixture() {
  const invoiceCreate = vi.fn(
    async (
      _params: Stripe.InvoiceCreateParams,
      _options?: Stripe.RequestOptions,
    ) =>
      Promise.resolve({
        id: "in_clockwork",
        status: "draft",
      } as Stripe.Invoice),
  );
  const invoiceItemCreate = vi.fn(
    async (
      _params: Stripe.InvoiceItemCreateParams,
      _options?: Stripe.RequestOptions,
    ) => Promise.resolve({ id: "ii_clockwork" } as Stripe.InvoiceItem),
  );
  const finalizeInvoice = vi.fn(async () =>
    Promise.resolve({ id: "in_clockwork", status: "open" } as Stripe.Invoice),
  );
  const scheduleCreate = vi.fn(async () =>
    Promise.resolve({
      id: "sub_sched_clockwork",
      status: "not_started",
    } as Stripe.SubscriptionSchedule),
  );
  const meterCreate = vi.fn(
    async (
      _params: Stripe.Billing.MeterEventCreateParams,
      _options?: Stripe.RequestOptions,
    ) =>
      Promise.resolve({
        identifier: "usage_evt_1",
      } as Stripe.Billing.MeterEvent),
  );
  const client = {
    invoices: {
      create: invoiceCreate,
      finalizeInvoice,
      sendInvoice: vi.fn(),
    },
    invoiceItems: { create: invoiceItemCreate },
    subscriptionSchedules: { create: scheduleCreate },
    billing: { meterEvents: { create: meterCreate } },
  } as unknown as Stripe;
  return {
    client,
    invoiceCreate,
    invoiceItemCreate,
    finalizeInvoice,
    scheduleCreate,
    meterCreate,
  };
}

describe("StripeFinanceGateway", () => {
  it("creates consolidated invoice lines with tax and end-client grouping metadata", async () => {
    const fixture = stripeClientFixture();
    const gateway = new StripeFinanceGateway({ client: fixture.client });
    const result = await gateway.createInvoice({
      customerId: "cus_partner",
      orderId,
      invoiceReference: "commerce_invoice_1",
      currency: "USD",
      collection: { kind: "net_terms", days: 30 },
      poNumber: "PO-1008",
      lines: [
        {
          lineId: "line_end_client_1",
          description: "Storage - End Client One",
          amount: MoneySchema.parse({ currency: "USD", minor: "12500" }),
          taxCode: "txcd_10102000",
          endClientAccountId: endClientId,
          servicePeriod: {
            startsAt: "2026-08-01T00:00:00.000Z",
            endsAt: "2026-08-31T23:59:59.000Z",
          },
        },
      ],
      autoFinalize: true,
      idempotencyKey,
    });
    expect(result).toEqual({
      ok: true,
      value: { providerInvoiceId: "in_clockwork", status: "open" },
    });
    expect(fixture.invoiceCreate.mock.calls[0]?.[0]).toMatchObject({
      customer: "cus_partner",
      collection_method: "send_invoice",
      days_until_due: 30,
      automatic_tax: { enabled: true },
      custom_fields: [{ name: "PO", value: "PO-1008" }],
    });
    expect(
      typeof fixture.invoiceCreate.mock.calls[0]?.[1]?.idempotencyKey,
    ).toBe("string");
    expect(fixture.invoiceItemCreate.mock.calls[0]?.[0]).toMatchObject({
      amount: 12_500,
      tax_code: "txcd_10102000",
      metadata: { end_client_account_id: endClientId },
    });
    expect(
      typeof fixture.invoiceItemCreate.mock.calls[0]?.[1]?.idempotencyKey,
    ).toBe("string");
    const invoiceKey = fixture.invoiceCreate.mock.calls[0]?.[1]?.idempotencyKey;
    const lineKey =
      fixture.invoiceItemCreate.mock.calls[0]?.[1]?.idempotencyKey;
    expect(invoiceKey).not.toBe(lineKey);
    expect(fixture.finalizeInvoice).toHaveBeenCalledOnce();
  });

  it("maps renewal and amendment phases into one contiguous Stripe schedule", async () => {
    const fixture = stripeClientFixture();
    const gateway = new StripeFinanceGateway({ client: fixture.client });
    const result = await gateway.createSubscriptionSchedule({
      customerId: "cus_direct",
      orderId,
      phases: [
        {
          startsAt: "2026-08-01T00:00:00.000Z",
          endsAt: "2027-02-01T00:00:00.000Z",
          items: [{ priceId: "price_initial", quantity: 1 }],
          collection: { kind: "auto_charge", paymentMethodId: "pm_card" },
        },
        {
          startsAt: "2027-02-01T00:00:00.000Z",
          endsAt: "2027-08-01T00:00:00.000Z",
          items: [{ priceId: "price_amended", quantity: 2 }],
          collection: { kind: "auto_charge", paymentMethodId: "pm_card" },
        },
      ],
      endBehavior: "release",
      idempotencyKey,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { scheduleId: "sub_sched_clockwork" },
    });
    expect(fixture.scheduleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        phases: [
          expect.objectContaining({
            items: [{ price: "price_initial", quantity: 1 }],
          }),
          expect.objectContaining({
            items: [{ price: "price_amended", quantity: 2 }],
          }),
        ],
      }),
      expect.any(Object),
    );
  });

  it("reports only ledger-priced overage using the source usage ID as provider identifier", async () => {
    const fixture = stripeClientFixture();
    const gateway = new StripeFinanceGateway({ client: fixture.client });
    const result = await gateway.reportMeteredOverage({
      eventName: "storage_overage",
      customerId: "cus_direct",
      quantity: "1.125",
      occurredAt: "2026-07-31T16:00:00.000Z",
      usageEventId: "usage_evt_1",
      idempotencyKey,
    });
    expect(result).toMatchObject({ ok: true });
    expect(fixture.meterCreate.mock.calls[0]?.[0]).toEqual({
      event_name: "storage_overage",
      identifier: "usage_evt_1",
      timestamp: 1_785_513_600,
      payload: { stripe_customer_id: "cus_direct", value: "1.125" },
    });
    expect(typeof fixture.meterCreate.mock.calls[0]?.[1]?.idempotencyKey).toBe(
      "string",
    );
  });
});
