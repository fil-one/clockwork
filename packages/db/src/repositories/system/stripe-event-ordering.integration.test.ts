import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, like, or } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase, type RuntimeTransaction } from "../../client";
import {
  auditEvents,
  disputeCases,
  invoices,
  orders,
  outboxMessages,
  payments,
  quotes,
  webhookEvents,
} from "../../schema";
import { providerProjectionCheckpoints } from "../../schema/system";
import { withInternalTransaction } from "../../transaction";
import {
  DatabaseStripeFinancialProjection,
  type StripeFinancialProjectionEvent,
} from "./providers";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const prefix = "integration-stripe-event-ordering-";
// A seeded direct order and its invoicing account. The projection is the
// subject here, so the invoice it lands on is written directly rather than
// through the finance repository.
const accountId = "10000000-0000-4000-8000-000000000004";
const orderId = "80000000-0000-4000-8000-000000000007";

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 10,
  role: "clockwork_service",
  ssl: false,
});
const projection = new DatabaseStripeFinancialProjection(db);

function internal<T>(
  requestId: string,
  operation: (transaction: RuntimeTransaction) => Promise<T>,
): Promise<T> {
  return withInternalTransaction(db, requestId, operation);
}

async function cleanup(): Promise<void> {
  await internal(`${prefix}cleanup`, async (transaction) => {
    const events = await transaction
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(like(auditEvents.requestId, `stripe:${prefix}%`));
    const eventIds = events.map((event) => event.id);
    if (eventIds.length) {
      await transaction
        .delete(outboxMessages)
        .where(inArray(outboxMessages.eventId, eventIds));
      await transaction
        .delete(auditEvents)
        .where(inArray(auditEvents.id, eventIds));
    }
    await transaction
      .delete(disputeCases)
      .where(like(disputeCases.stripeDisputeId, `dp_${prefix}%`));
    await transaction
      .delete(payments)
      .where(like(payments.stripePaymentIntentId, `pi_${prefix}%`));
    await transaction
      .delete(invoices)
      .where(like(invoices.stripeInvoiceId, `in_${prefix}%`));
    await transaction
      .delete(webhookEvents)
      .where(
        and(
          eq(webhookEvents.provider, "stripe"),
          like(webhookEvents.providerEventId, `${prefix}%`),
        ),
      );
    await transaction
      .delete(providerProjectionCheckpoints)
      .where(
        and(
          eq(providerProjectionCheckpoints.provider, "stripe"),
          or(
            like(providerProjectionCheckpoints.aggregateKey, `in_${prefix}%`),
            like(providerProjectionCheckpoints.aggregateKey, `pi_${prefix}%`),
          ),
        ),
      );
  });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await client.end();
});

interface OpenInvoice {
  readonly invoiceId: string;
  readonly providerInvoiceId: string;
  readonly currency: string;
  readonly amountMinor: bigint;
}

async function openInvoice(suffix: string): Promise<OpenInvoice> {
  const providerInvoiceId = `in_${prefix}${suffix}`;
  return internal(`${prefix}invoice-${suffix}`, async (transaction) => {
    // An invoice may only carry the commercial truth of its accepted order.
    const order = await transaction.query.orders.findFirst({
      where: eq(orders.id, orderId),
    });
    const quote = order
      ? await transaction.query.quotes.findFirst({
          where: eq(quotes.id, order.quoteId),
        })
      : undefined;
    if (!order || !quote) throw new Error("Seeded order fixture is missing");
    const [row] = await transaction
      .insert(invoices)
      .values({
        orderId,
        accountId,
        stripeInvoiceId: providerInvoiceId,
        currency: quote.currency,
        amountMinor: quote.totalMinor,
        poNumber: order.poNumber,
        status: "open",
        dueAt: new Date("2031-02-01T00:00:00.000Z"),
      })
      .returning();
    if (!row) throw new Error("Open-invoice fixture is missing");
    return {
      invoiceId: row.id,
      providerInvoiceId,
      currency: row.currency,
      amountMinor: BigInt(row.amountMinor),
    };
  });
}

async function verifiedEvent(
  event: StripeFinancialProjectionEvent,
): Promise<StripeFinancialProjectionEvent> {
  await internal(`${prefix}webhook-${event.eventId}`, async (transaction) => {
    await transaction.insert(webhookEvents).values({
      provider: "stripe",
      providerEventId: event.eventId,
      eventType: event.eventType,
      signatureVerifiedAt: new Date(event.occurredAt),
      payloadHash: "c".repeat(64),
      payload: {
        type: event.eventType,
        event: { provider: "stripe", ...event },
      },
      occurredAt: new Date(event.occurredAt),
      lockedUntil: new Date("2031-12-31T00:00:00.000Z"),
    });
  });
  return event;
}

/** One intent settling part of an invoice; Stripe sends no invoice totals here. */
function intentEvent(
  invoice: OpenInvoice,
  suffix: string,
  minor: bigint,
  occurredAt: string,
): StripeFinancialProjectionEvent {
  return {
    eventId: `${prefix}${suffix}`,
    eventType: "payment_intent.succeeded",
    category: "payment",
    aggregateKey: invoice.providerInvoiceId,
    occurredAt,
    invoiceId: invoice.providerInvoiceId,
    paymentIntentId: `pi_${prefix}${suffix}`,
    amount: { currency: invoice.currency, minor: minor.toString() },
    status: "succeeded",
  };
}

function readInvoice(invoice: OpenInvoice, label: string) {
  return internal(`${prefix}read-${label}`, async (transaction) => ({
    invoice: await transaction.query.invoices.findFirst({
      where: eq(invoices.id, invoice.invoiceId),
    }),
    payments: await transaction.query.payments.findMany({
      where: eq(payments.invoiceId, invoice.invoiceId),
      orderBy: [asc(payments.amountMinor)],
    }),
  }));
}

interface DisputedPayment {
  readonly disputeCaseId: string;
  readonly providerDisputeId: string;
  readonly paymentIntentId: string;
}

/** A settled payment carrying an open chargeback, ready for dispute events. */
async function disputedPayment(suffix: string): Promise<DisputedPayment> {
  const invoice = await openInvoice(`dispute-${suffix}`);
  const paymentIntentId = `pi_${prefix}dispute-${suffix}`;
  const providerDisputeId = `dp_${prefix}${suffix}`;
  return internal(`${prefix}dispute-${suffix}`, async (transaction) => {
    const [payment] = await transaction
      .insert(payments)
      .values({
        invoiceId: invoice.invoiceId,
        orderId,
        stripePaymentIntentId: paymentIntentId,
        currency: invoice.currency,
        amountMinor: invoice.amountMinor,
        status: "succeeded",
        receivedAt: new Date("2031-01-01T00:00:00.000Z"),
      })
      .returning();
    if (!payment) throw new Error("Disputed-payment fixture is missing");
    const [row] = await transaction
      .insert(disputeCases)
      .values({
        paymentId: payment.id,
        orderId,
        stripeDisputeId: providerDisputeId,
        currency: invoice.currency,
        amountMinor: invoice.amountMinor,
        evidenceDueAt: new Date("2031-02-01T00:00:00.000Z"),
        status: "needs_response",
      })
      .returning();
    if (!row) throw new Error("Dispute-case fixture is missing");
    return { disputeCaseId: row.id, providerDisputeId, paymentIntentId };
  });
}

function disputeEvent(
  dispute: DisputedPayment,
  suffix: string,
  eventType: string,
  detail: { status: string; occurredAt: string },
): StripeFinancialProjectionEvent {
  return {
    eventId: `${prefix}${suffix}`,
    eventType,
    category: "dispute",
    // Stripe keys a `charge.dispute.*` event by the intent it disputes.
    aggregateKey: dispute.paymentIntentId,
    occurredAt: detail.occurredAt,
    paymentIntentId: dispute.paymentIntentId,
    disputeId: dispute.providerDisputeId,
    status: detail.status,
  };
}

function readDispute(dispute: DisputedPayment, label: string) {
  return internal(`${prefix}read-dispute-${label}`, (transaction) =>
    transaction.query.disputeCases.findFirst({
      where: eq(disputeCases.id, dispute.disputeCaseId),
    }),
  );
}

function readProjectionAudit(eventIds: readonly string[], label: string) {
  return internal(`${prefix}audit-${label}`, (transaction) =>
    transaction.query.auditEvents.findMany({
      where: inArray(
        auditEvents.requestId,
        eventIds.map((eventId) => `stripe:${eventId}`),
      ),
      orderBy: [asc(auditEvents.occurredAt)],
    }),
  );
}

describe("Stripe projection event ordering", () => {
  it("settles both same-second siblings whichever identifier sorts lower", async () => {
    const suffix = randomUUID();
    const invoice = await openInvoice(suffix);
    const sameSecond = "2031-01-02T00:00:00.000Z";
    // Stripe stamps siblings with the same `created` second and its `evt_`
    // identifiers carry no order, so the one that sorts lower arrives second as
    // often as not. Neither payment may be dropped for sorting low.
    const half = invoice.amountMinor / 2n;
    const higher = await verifiedEvent(
      intentEvent(invoice, `${suffix}-b-higher`, half, sameSecond),
    );
    const lower = await verifiedEvent(
      intentEvent(
        invoice,
        `${suffix}-a-lower`,
        invoice.amountMinor - half,
        sameSecond,
      ),
    );
    expect(lower.eventId < higher.eventId).toBe(true);

    await projection.apply(higher);
    await projection.apply(lower);

    const state = await readInvoice(invoice, `siblings-${suffix}`);
    expect(state.payments).toHaveLength(2);
    expect(
      state.payments.reduce((sum, row) => sum + row.amountMinor, 0n),
    ).toEqual(invoice.amountMinor);
    expect(state.invoice).toMatchObject({
      status: "paid",
      amountPaidMinor: invoice.amountMinor,
      amountRemainingMinor: 0n,
    });
    const audited = await readProjectionAudit(
      [higher.eventId, lower.eventId],
      `siblings-${suffix}`,
    );
    expect(new Set(audited.map((event) => event.requestId))).toEqual(
      new Set([`stripe:${higher.eventId}`, `stripe:${lower.eventId}`]),
    );
  });

  it("projects a redelivered sibling once and only once", async () => {
    const suffix = randomUUID();
    const invoice = await openInvoice(suffix);
    const sameSecond = "2031-01-03T00:00:00.000Z";
    const half = invoice.amountMinor / 2n;
    const first = await verifiedEvent(
      intentEvent(invoice, `${suffix}-b-higher`, half, sameSecond),
    );
    const second = await verifiedEvent(
      intentEvent(
        invoice,
        `${suffix}-a-lower`,
        invoice.amountMinor - half,
        sameSecond,
      ),
    );

    await projection.apply(first);
    await projection.apply(second);
    const settled = await readInvoice(invoice, `settled-${suffix}`);
    // A webhook redelivered after its projection committed, in both orders: the
    // watermark no longer holds either identifier alone, so the append-only
    // trail is what makes the replay a no-op.
    await projection.apply(first);
    await projection.apply(second);

    const state = await readInvoice(invoice, `replay-${suffix}`);
    expect(state.payments).toHaveLength(2);
    expect(state.invoice).toMatchObject({
      amountPaidMinor: invoice.amountMinor,
      rowVersion: settled.invoice?.rowVersion,
    });
    const audited = await readProjectionAudit(
      [first.eventId, second.eventId],
      `replay-${suffix}`,
    );
    expect(
      audited.filter((event) => event.aggregateType === "payment"),
    ).toHaveLength(2);
    expect(
      audited.filter((event) => event.aggregateType === "invoice"),
    ).toHaveLength(2);
  });

  // ATTACK A. Stripe states no delivery order, so two intents stamped one
  // second apart arrive later-first as often as not. The earlier one is not
  // stale — it is money nobody else will ever report again.
  it("settles an earlier intent delivered after a later one", async () => {
    const suffix = randomUUID();
    const invoice = await openInvoice(suffix);
    const half = invoice.amountMinor / 2n;
    const earlier = await verifiedEvent(
      intentEvent(
        invoice,
        `${suffix}-earlier`,
        invoice.amountMinor - half,
        "2031-01-04T00:00:00.000Z",
      ),
    );
    const later = await verifiedEvent(
      intentEvent(invoice, `${suffix}-later`, half, "2031-01-04T00:00:01.000Z"),
    );

    await projection.apply(later);
    await projection.apply(earlier);

    const state = await readInvoice(invoice, `later-first-${suffix}`);
    expect(state.payments).toHaveLength(2);
    expect(
      state.payments.reduce((sum, row) => sum + row.amountMinor, 0n),
    ).toEqual(invoice.amountMinor);
    expect(state.invoice).toMatchObject({
      status: "paid",
      amountPaidMinor: invoice.amountMinor,
      amountRemainingMinor: 0n,
    });
    const audited = await readProjectionAudit(
      [earlier.eventId, later.eventId],
      `later-first-${suffix}`,
    );
    expect(new Set(audited.map((event) => event.requestId))).toEqual(
      new Set([`stripe:${earlier.eventId}`, `stripe:${later.eventId}`]),
    );
  });

  // ATTACK B. The same-second tie only rescued a sibling while the tie still
  // held the watermark. Once any later event landed, the sibling behind it was
  // dropped exactly as before, and a -> c -> b is as likely as a -> b -> c.
  it("settles a same-second sibling delivered behind a later event", async () => {
    const suffix = randomUUID();
    const invoice = await openInvoice(suffix);
    const third = invoice.amountMinor / 3n;
    const remainder = invoice.amountMinor - third - third;
    const first = await verifiedEvent(
      intentEvent(invoice, `${suffix}-a`, third, "2031-01-06T00:00:00.000Z"),
    );
    const sibling = await verifiedEvent(
      intentEvent(invoice, `${suffix}-b`, third, "2031-01-06T00:00:00.000Z"),
    );
    const later = await verifiedEvent(
      intentEvent(
        invoice,
        `${suffix}-c`,
        remainder,
        "2031-01-06T00:00:05.000Z",
      ),
    );

    await projection.apply(first);
    await projection.apply(later);
    await projection.apply(sibling);

    const state = await readInvoice(invoice, `straggler-${suffix}`);
    expect(state.payments).toHaveLength(3);
    expect(
      state.payments.reduce((sum, row) => sum + row.amountMinor, 0n),
    ).toEqual(invoice.amountMinor);
    expect(state.invoice).toMatchObject({
      status: "paid",
      amountPaidMinor: invoice.amountMinor,
      amountRemainingMinor: 0n,
    });
    const audited = await readProjectionAudit(
      [first.eventId, sibling.eventId, later.eventId],
      `straggler-${suffix}`,
    );
    expect(new Set(audited.map((event) => event.requestId))).toEqual(
      new Set([
        `stripe:${first.eventId}`,
        `stripe:${sibling.eventId}`,
        `stripe:${later.eventId}`,
      ]),
    );
  });

  // ATTACK C. `won` and `lost` are terminal in Stripe's dispute lifecycle. A
  // later-delivered phase event restates where the dispute has been, never
  // where it now is, so it may not reopen a closed one.
  it("keeps a won dispute won when a phase event is delivered behind it", async () => {
    const suffix = randomUUID();
    const dispute = await disputedPayment(suffix);
    const closed = await verifiedEvent(
      disputeEvent(dispute, `${suffix}-z-closed`, "charge.dispute.closed", {
        status: "won",
        occurredAt: "2031-01-07T00:00:00.000Z",
      }),
    );
    const phase = await verifiedEvent(
      disputeEvent(dispute, `${suffix}-a-phase`, "charge.dispute.updated", {
        status: "warning_needs_response",
        occurredAt: "2031-01-07T00:00:00.000Z",
      }),
    );

    await projection.apply(closed);
    await projection.apply(phase);

    await expect(readDispute(dispute, `won-${suffix}`)).resolves.toMatchObject({
      status: "won",
    });
  });

  it("refuses two closures that disagree about the outcome", async () => {
    const suffix = randomUUID();
    const dispute = await disputedPayment(suffix);
    const won = await verifiedEvent(
      disputeEvent(dispute, `${suffix}-won`, "charge.dispute.closed", {
        status: "won",
        occurredAt: "2031-01-08T00:00:00.000Z",
      }),
    );
    const lost = await verifiedEvent(
      disputeEvent(dispute, `${suffix}-lost`, "charge.dispute.closed", {
        status: "lost",
        occurredAt: "2031-01-08T00:00:00.000Z",
      }),
    );

    await projection.apply(won);
    await expect(projection.apply(lost)).rejects.toThrow(
      /dispute outcome conflicted/i,
    );
    await expect(
      readDispute(dispute, `conflict-${suffix}`),
    ).resolves.toMatchObject({ status: "won" });
  });
});
