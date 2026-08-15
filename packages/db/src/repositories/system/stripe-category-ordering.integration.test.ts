import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, like, notInArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase, type RuntimeTransaction } from "../../client";
import {
  auditEvents,
  creditNotes,
  disputeCases,
  invoices,
  orders,
  outboxMessages,
  payments,
  quotes,
  refunds,
  webhookEvents,
} from "../../schema";
import { providerProjectionCheckpoints } from "../../schema/system";
import { withInternalTransaction } from "../../transaction";
import {
  DatabaseStripeFinancialProjection,
  type StripeFinancialProjectionEvent,
} from "./providers";

/**
 * The same-second sibling probe, run against every category this projection
 * dispatches on rather than only the payment one. Each probe delivers three
 * events — `a` and `b` stamped the same second, `c` five seconds later — in the
 * order a -> c -> b, and reads the resulting rows back out of the database. The
 * one-second-apart later-first variant runs alongside it. What is asserted is
 * never "the reducer looks monotone": it is the row the reducer left behind and
 * the audit trail that says what became of the straggler. `apply()` returning
 * void is an ack, so an event that leaves no row and no audit row is money the
 * inbox has thrown away.
 */

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const prefix = "integration-stripe-category-ordering-";
const accountId = "10000000-0000-4000-8000-000000000004";
const orderId = "80000000-0000-4000-8000-000000000007";
const internalUserId = "20000000-0000-4000-8000-000000000001";

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

/**
 * Credit notes and refunds are append-only by database trigger, so the fixtures
 * that carry them and the invoices and payments they hang off outlive the run.
 * Everything else this suite writes is removed.
 */
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
    const retainedPayments = await transaction
      .select({ id: refunds.paymentId })
      .from(refunds)
      .where(like(refunds.stripeRefundId, `re_${prefix}%`));
    const retainedPaymentIds = [
      ...new Set(retainedPayments.map((row) => row.id)),
    ];
    const retainedFromNotes = await transaction
      .select({ id: creditNotes.invoiceId })
      .from(creditNotes)
      .where(like(creditNotes.stripeCreditNoteId, `cn_${prefix}%`));
    const retainedFromPayments = retainedPaymentIds.length
      ? await transaction
          .select({ id: payments.invoiceId })
          .from(payments)
          .where(inArray(payments.id, retainedPaymentIds))
      : [];
    const retainedInvoiceIds = [
      ...new Set(
        [...retainedFromNotes, ...retainedFromPayments].map((row) => row.id),
      ),
    ];

    await transaction
      .delete(disputeCases)
      .where(like(disputeCases.stripeDisputeId, `dp_${prefix}%`));
    const paymentScope = like(payments.stripePaymentIntentId, `pi_${prefix}%`);
    await transaction
      .delete(payments)
      .where(
        retainedPaymentIds.length
          ? and(paymentScope, notInArray(payments.id, retainedPaymentIds))
          : paymentScope,
      );
    const invoiceScope = like(invoices.stripeInvoiceId, `in_${prefix}%`);
    await transaction
      .delete(invoices)
      .where(
        retainedInvoiceIds.length
          ? and(invoiceScope, notInArray(invoices.id, retainedInvoiceIds))
          : invoiceScope,
      );
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
          like(providerProjectionCheckpoints.aggregateKey, `%${prefix}%`),
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
        dueAt: new Date("2032-02-01T00:00:00.000Z"),
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

interface SettledPayment {
  readonly invoice: OpenInvoice;
  readonly paymentId: string;
  readonly paymentIntentId: string;
}

async function settledPayment(
  invoice: OpenInvoice,
  suffix: string,
): Promise<SettledPayment> {
  const paymentIntentId = `pi_${prefix}${suffix}`;
  return internal(`${prefix}payment-${suffix}`, async (transaction) => {
    const [row] = await transaction
      .insert(payments)
      .values({
        invoiceId: invoice.invoiceId,
        orderId,
        stripePaymentIntentId: paymentIntentId,
        currency: invoice.currency,
        amountMinor: invoice.amountMinor,
        status: "succeeded",
        receivedAt: new Date("2032-01-01T00:00:00.000Z"),
      })
      .returning();
    if (!row) throw new Error("Settled-payment fixture is missing");
    return { invoice, paymentId: row.id, paymentIntentId };
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
      payloadHash: "d".repeat(64),
      payload: {
        type: event.eventType,
        event: { provider: "stripe", ...event },
      },
      occurredAt: new Date(event.occurredAt),
      lockedUntil: new Date("2032-12-31T00:00:00.000Z"),
    });
  });
  return event;
}

function readInvoice(invoice: OpenInvoice, label: string) {
  return internal(`${prefix}read-${label}`, async (transaction) => ({
    invoice: await transaction.query.invoices.findFirst({
      where: eq(invoices.id, invoice.invoiceId),
    }),
    payments: await transaction.query.payments.findMany({
      where: eq(payments.invoiceId, invoice.invoiceId),
      orderBy: [asc(payments.stripePaymentIntentId)],
    }),
  }));
}

function readAudit(eventIds: readonly string[], label: string) {
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

/**
 * Every delivered event must leave at least one audit row behind; the returned
 * map gives each event's dispositions, or its aggregate types where the
 * reducer projected real state rather than a note.
 */
async function expectTraced(
  eventIds: readonly string[],
  label: string,
): Promise<Map<string, readonly string[]>> {
  const rows = await readAudit(eventIds, label);
  const byEvent = new Map<string, readonly string[]>();
  for (const eventId of eventIds) {
    const matching = rows.filter(
      (row) => row.requestId === `stripe:${eventId}`,
    );
    expect(
      matching.length,
      `event ${eventId} left no audit trace`,
    ).toBeGreaterThan(0);
    byEvent.set(
      eventId,
      matching.map((row) => {
        const after = row.after as Record<string, unknown> | null;
        return typeof after?.disposition === "string"
          ? after.disposition
          : String(row.aggregateType);
      }),
    );
  }
  return byEvent;
}

const SUBSUMED = "subsumed_by_newer_provider_event";

// ---------------------------------------------------------------------------
// invoice
// ---------------------------------------------------------------------------

function invoiceUpdated(
  invoice: OpenInvoice,
  suffix: string,
  occurredAt: string,
): StripeFinancialProjectionEvent {
  return {
    eventId: `${prefix}${suffix}`,
    eventType: "invoice.updated",
    category: "invoice",
    aggregateKey: invoice.providerInvoiceId,
    occurredAt,
    invoiceId: invoice.providerInvoiceId,
    status: "open",
  };
}

function invoicePaymentSucceeded(
  invoice: OpenInvoice,
  suffix: string,
  minor: bigint,
  occurredAt: string,
): StripeFinancialProjectionEvent {
  return {
    eventId: `${prefix}${suffix}`,
    eventType: "invoice.payment_succeeded",
    category: "invoice",
    aggregateKey: invoice.providerInvoiceId,
    occurredAt,
    invoiceId: invoice.providerInvoiceId,
    paymentIntentId: `pi_${prefix}${suffix}`,
    amount: { currency: invoice.currency, minor: minor.toString() },
    status: "paid",
  };
}

/**
 * One installment of a part-paid invoice. Stripe states the intent's own money
 * here and no invoice totals, so what the installment settles is accounted for
 * by nothing but the payment row it creates: no later event restates it.
 */
function invoiceInstallmentPaid(
  invoice: OpenInvoice,
  suffix: string,
  minor: bigint,
  occurredAt: string,
  status: "open" | "paid",
): StripeFinancialProjectionEvent {
  return {
    eventId: `${prefix}${suffix}`,
    eventType: "invoice_payment.paid",
    category: "invoice",
    aggregateKey: invoice.providerInvoiceId,
    occurredAt,
    invoiceId: invoice.providerInvoiceId,
    paymentIntentId: `pi_${prefix}${suffix}`,
    amount: { currency: invoice.currency, minor: minor.toString() },
    status,
  };
}

describe("Stripe projection ordering by category: invoice", () => {
  // An `invoice.payment_succeeded` names the intent that settled the invoice.
  // That intent is per-payment money exactly as a `payment_intent.succeeded` is,
  // so the row it creates cannot be traded away for a note saying some newer
  // invoice-phase event has already spoken for the aggregate.
  it("binds the intent of a same-second invoice payment delivered behind a later event", async () => {
    const suffix = randomUUID();
    const invoice = await openInvoice(suffix);
    const first = await verifiedEvent(
      invoiceUpdated(invoice, `${suffix}-a`, "2032-01-06T00:00:00.000Z"),
    );
    const later = await verifiedEvent(
      invoiceUpdated(invoice, `${suffix}-c`, "2032-01-06T00:00:05.000Z"),
    );
    const sibling = await verifiedEvent(
      invoicePaymentSucceeded(
        invoice,
        `${suffix}-b`,
        invoice.amountMinor,
        "2032-01-06T00:00:00.000Z",
      ),
    );

    await projection.apply(first);
    await projection.apply(later);
    await projection.apply(sibling);

    const state = await readInvoice(invoice, `invoice-straggler-${suffix}`);
    expect(state.payments).toHaveLength(1);
    expect(state.payments[0]).toMatchObject({
      stripePaymentIntentId: `pi_${prefix}${suffix}-b`,
      status: "succeeded",
      amountMinor: invoice.amountMinor,
    });
    expect(state.invoice).toMatchObject({
      status: "paid",
      amountPaidMinor: invoice.amountMinor,
      amountRemainingMinor: 0n,
    });
    // The straggler applies but does not get to claim it is the latest word.
    expect(state.invoice?.stripeLastEventId).toEqual(later.eventId);
    await expectTraced(
      [first.eventId, later.eventId, sibling.eventId],
      `invoice-straggler-${suffix}`,
    );
  });

  it("binds the intent of an earlier invoice payment delivered after a later event", async () => {
    const suffix = randomUUID();
    const invoice = await openInvoice(suffix);
    const later = await verifiedEvent(
      invoiceUpdated(invoice, `${suffix}-later`, "2032-01-07T00:00:01.000Z"),
    );
    const earlier = await verifiedEvent(
      invoicePaymentSucceeded(
        invoice,
        `${suffix}-earlier`,
        invoice.amountMinor,
        "2032-01-07T00:00:00.000Z",
      ),
    );

    await projection.apply(later);
    await projection.apply(earlier);

    const state = await readInvoice(invoice, `invoice-later-first-${suffix}`);
    expect(state.payments).toHaveLength(1);
    expect(state.payments[0]).toMatchObject({
      stripePaymentIntentId: `pi_${prefix}${suffix}-earlier`,
      status: "succeeded",
    });
    expect(state.invoice).toMatchObject({
      status: "paid",
      amountPaidMinor: invoice.amountMinor,
      amountRemainingMinor: 0n,
    });
    await expectTraced(
      [later.eventId, earlier.eventId],
      `invoice-later-first-${suffix}`,
    );
  });

  // THE REFUSAL BOUNDARY for the invoice carve-out. A late invoice event that
  // names no intent restates a running total the row has already passed. It
  // carries no per-intent money, so it must still be accepted and recorded as
  // subsumed — neither raised nor replayed over the newer phase.
  it("still records a late intent-free invoice restatement as subsumed", async () => {
    const suffix = randomUUID();
    const invoice = await openInvoice(suffix);
    const later = await verifiedEvent(
      invoiceUpdated(invoice, `${suffix}-late-c`, "2032-01-08T00:00:05.000Z"),
    );
    const earlier = await verifiedEvent(
      invoiceUpdated(invoice, `${suffix}-late-a`, "2032-01-08T00:00:00.000Z"),
    );

    await projection.apply(later);
    await expect(projection.apply(earlier)).resolves.toBeUndefined();

    const traced = await expectTraced(
      [earlier.eventId],
      `invoice-subsumed-${suffix}`,
    );
    expect(traced.get(earlier.eventId)).toEqual([SUBSUMED]);
    const state = await readInvoice(invoice, `invoice-subsumed-${suffix}`);
    expect(state.invoice?.stripeLastEventId).toEqual(later.eventId);
  });

  // THE OTHER SIDE of the same boundary. A late invoice event that states a
  // running total the row has already passed is accounted for whatever intent
  // it names, and binding that intent would book the settled money a second
  // time. Naming an intent is not on its own a reason to apply a late event.
  /**
   * A redelivery of the SAME intent must be idempotent, and that is the only
   * shape an invoice-category event may be answered with a note for.
   *
   * This test used to assert the opposite of what it now asserts, and doing so
   * canonized a money loss: it delivered two DISTINCT intents and required the
   * later-stamped one to subsume the earlier, on the reasoning that the
   * invoice-level total already held the amount. Two distinct intents are two
   * genuine payments, so the second one's money had no payments row and the
   * invoice stayed collectable for it. Whether a per-intent row should exist is
   * not answerable from an invoice-level total. The distinct-intent case is now
   * the installment probe below; this one covers the true duplicate.
   */
  it("books a redelivered invoice intent exactly once", async () => {
    const suffix = randomUUID();
    const invoice = await openInvoice(suffix);
    const settlement = {
      currency: invoice.currency,
      minor: invoice.amountMinor.toString(),
    };
    // One intent, delivered twice — the same eventId suffix, so the same
    // `pi_` identifier — with the redelivery stamped earlier.
    const settled = invoicePaymentSucceeded(
      invoice,
      `${suffix}-settled`,
      invoice.amountMinor,
      "2032-01-08T00:00:20.000Z",
    );
    const current = await verifiedEvent({
      ...settled,
      amountDue: settlement,
      amountPaid: settlement,
      amountRemaining: { currency: invoice.currency, minor: "0" },
    });
    const redelivered = await verifiedEvent({
      ...settled,
      eventId: `${settled.eventId}-redelivered`,
      occurredAt: "2032-01-08T00:00:10.000Z",
      amountDue: settlement,
      amountPaid: settlement,
      amountRemaining: { currency: invoice.currency, minor: "0" },
    });

    await projection.apply(current);
    await expect(projection.apply(redelivered)).resolves.toBeUndefined();

    const state = await readInvoice(invoice, `invoice-accounted-${suffix}`);
    // One intent, one row, however many times it arrives.
    expect(state.payments).toHaveLength(1);
    expect(state.invoice).toMatchObject({
      status: "paid",
      amountPaidMinor: invoice.amountMinor,
      amountRemainingMinor: 0n,
    });
  });

  it("books a late second intent rather than subsuming it", async () => {
    const suffix = randomUUID();
    const invoice = await openInvoice(suffix);
    const half = invoice.amountMinor / 2n;
    const settlement = {
      currency: invoice.currency,
      minor: invoice.amountMinor.toString(),
    };
    // The first installment arrives second, stamped earlier, and its stated
    // invoice total is already held by the row. Its intent is still real money.
    const closing = await verifiedEvent({
      ...invoicePaymentSucceeded(
        invoice,
        `${suffix}-closing`,
        invoice.amountMinor - half,
        "2032-01-08T00:00:20.000Z",
      ),
      amountDue: settlement,
      amountPaid: settlement,
      amountRemaining: { currency: invoice.currency, minor: "0" },
    });
    const late = await verifiedEvent({
      ...invoicePaymentSucceeded(
        invoice,
        `${suffix}-late`,
        half,
        "2032-01-08T00:00:10.000Z",
      ),
      amountDue: settlement,
      amountPaid: { currency: invoice.currency, minor: half.toString() },
      amountRemaining: {
        currency: invoice.currency,
        minor: (invoice.amountMinor - half).toString(),
      },
    });

    await projection.apply(closing);
    await expect(projection.apply(late)).resolves.toBeUndefined();

    const state = await readInvoice(invoice, `invoice-accounted-${suffix}`);
    // Two intents, two rows. Before this fix the late one produced no row at
    // all and only a subsumed note, so its money was received and unrecorded.
    expect(state.payments).toHaveLength(2);
    expect(state.invoice).toMatchObject({
      status: "paid",
      amountPaidMinor: invoice.amountMinor,
      amountRemainingMinor: 0n,
    });
  });

  // The installment probe. An invoice settled by two intents delivers three
  // events: `a` and `b` are the two installments, stamped the same second, and
  // `c` is a later phase event. Neither installment states an invoice total, so
  // each is accounted for by its own payment row and nothing else. The two
  // orders below must leave byte-identical money on the invoice; if the
  // straggler is answered with a note instead, the second installment is
  // received money with no row, and the invoice stays collectable for it.
  const installmentOutcome = (invoice: OpenInvoice) => ({
    status: "paid",
    amountPaidMinor: invoice.amountMinor,
    amountRemainingMinor: 0n,
  });

  it("books both installments in Stripe's own order", async () => {
    const suffix = randomUUID();
    const invoice = await openInvoice(suffix);
    const firstInstallment = await verifiedEvent(
      invoiceInstallmentPaid(
        invoice,
        `${suffix}-a`,
        120_000n,
        "2032-01-09T00:00:00.000Z",
        "open",
      ),
    );
    const finalInstallment = await verifiedEvent(
      invoiceInstallmentPaid(
        invoice,
        `${suffix}-b`,
        invoice.amountMinor - 120_000n,
        "2032-01-09T00:00:00.000Z",
        "paid",
      ),
    );
    const later = await verifiedEvent(
      invoiceUpdated(invoice, `${suffix}-c`, "2032-01-09T00:00:05.000Z"),
    );

    await projection.apply(firstInstallment);
    await projection.apply(finalInstallment);
    await projection.apply(later);

    const state = await readInvoice(invoice, `installments-abc-${suffix}`);
    expect(
      state.payments.map((row) => [row.stripePaymentIntentId, row.amountMinor]),
    ).toEqual([
      [`pi_${prefix}${suffix}-a`, 120_000n],
      [`pi_${prefix}${suffix}-b`, invoice.amountMinor - 120_000n],
    ]);
    expect(state.invoice).toMatchObject(installmentOutcome(invoice));
    await expectTraced(
      [firstInstallment.eventId, finalInstallment.eventId, later.eventId],
      `installments-abc-${suffix}`,
    );
  });

  it("books both installments when the second is delivered behind a later phase event", async () => {
    const suffix = randomUUID();
    const invoice = await openInvoice(suffix);
    const firstInstallment = await verifiedEvent(
      invoiceInstallmentPaid(
        invoice,
        `${suffix}-a`,
        120_000n,
        "2032-01-10T00:00:00.000Z",
        "open",
      ),
    );
    const finalInstallment = await verifiedEvent(
      invoiceInstallmentPaid(
        invoice,
        `${suffix}-b`,
        invoice.amountMinor - 120_000n,
        "2032-01-10T00:00:00.000Z",
        "paid",
      ),
    );
    const later = await verifiedEvent(
      invoiceUpdated(invoice, `${suffix}-c`, "2032-01-10T00:00:05.000Z"),
    );

    await projection.apply(firstInstallment);
    await projection.apply(later);
    await projection.apply(finalInstallment);

    const state = await readInvoice(invoice, `installments-acb-${suffix}`);
    expect(
      state.payments.map((row) => [row.stripePaymentIntentId, row.amountMinor]),
    ).toEqual([
      [`pi_${prefix}${suffix}-a`, 120_000n],
      [`pi_${prefix}${suffix}-b`, invoice.amountMinor - 120_000n],
    ]);
    expect(state.invoice).toMatchObject(installmentOutcome(invoice));
    // The straggler applies but does not get to claim it is the latest word.
    expect(state.invoice?.stripeLastEventId).toEqual(later.eventId);
    await expectTraced(
      [firstInstallment.eventId, later.eventId, finalInstallment.eventId],
      `installments-acb-${suffix}`,
    );
  });
});

// ---------------------------------------------------------------------------
// credit_note
// ---------------------------------------------------------------------------

interface CreditNoteFixture {
  readonly creditNoteId: string;
  readonly providerCreditNoteId: string;
  readonly invoice: OpenInvoice;
  readonly amountMinor: bigint;
}

async function creditNote(
  suffix: string,
  options: {
    status?: string;
    invoice?: OpenInvoice;
    amountMinor?: bigint;
  } = {},
): Promise<CreditNoteFixture> {
  const invoice = options.invoice ?? (await openInvoice(`cn-${suffix}`));
  const amountMinor = options.amountMinor ?? invoice.amountMinor;
  const providerCreditNoteId = `cn_${prefix}${suffix}`;
  return internal(`${prefix}credit-note-${suffix}`, async (transaction) => {
    const [row] = await transaction
      .insert(creditNotes)
      .values({
        invoiceId: invoice.invoiceId,
        orderId,
        stripeCreditNoteId: providerCreditNoteId,
        currency: invoice.currency,
        amountMinor,
        reasonCode: "commercial_correction",
        approvedBy: internalUserId,
        status: options.status ?? "pending",
      })
      .returning();
    if (!row) throw new Error("Credit-note fixture is missing");
    return {
      creditNoteId: row.id,
      providerCreditNoteId,
      invoice,
      amountMinor,
    };
  });
}

function creditNoteEvent(
  fixture: CreditNoteFixture,
  suffix: string,
  eventType: string,
  detail: { status: string; occurredAt: string },
): StripeFinancialProjectionEvent {
  return {
    eventId: `${prefix}${suffix}`,
    eventType,
    category: "credit_note",
    aggregateKey: fixture.providerCreditNoteId,
    occurredAt: detail.occurredAt,
    invoiceId: fixture.invoice.providerInvoiceId,
    creditNoteId: fixture.providerCreditNoteId,
    amount: {
      currency: fixture.invoice.currency,
      minor: fixture.amountMinor.toString(),
    },
    status: detail.status,
  };
}

function readCreditNote(fixture: CreditNoteFixture, label: string) {
  return internal(`${prefix}read-cn-${label}`, (transaction) =>
    transaction.query.creditNotes.findFirst({
      where: eq(creditNotes.id, fixture.creditNoteId),
    }),
  );
}

describe("Stripe projection ordering by category: credit_note", () => {
  it("keeps the later phase and traces a same-second sibling delivered behind it", async () => {
    const suffix = randomUUID();
    const fixture = await creditNote(suffix);
    const first = await verifiedEvent(
      creditNoteEvent(fixture, `${suffix}-a`, "credit_note.updated", {
        status: "issued",
        occurredAt: "2032-01-09T00:00:00.000Z",
      }),
    );
    const later = await verifiedEvent(
      creditNoteEvent(fixture, `${suffix}-c`, "credit_note.voided", {
        status: "void",
        occurredAt: "2032-01-09T00:00:05.000Z",
      }),
    );
    const sibling = await verifiedEvent(
      creditNoteEvent(fixture, `${suffix}-b`, "credit_note.created", {
        status: "draft",
        occurredAt: "2032-01-09T00:00:00.000Z",
      }),
    );

    await projection.apply(first);
    await projection.apply(later);
    await expect(projection.apply(sibling)).resolves.toBeUndefined();

    await expect(
      readCreditNote(fixture, `straggler-${suffix}`),
    ).resolves.toMatchObject({ status: "void" });
    const traced = await expectTraced(
      [first.eventId, later.eventId, sibling.eventId],
      `cn-straggler-${suffix}`,
    );
    expect(traced.get(sibling.eventId)).toEqual([SUBSUMED]);
  });

  it("traces an earlier credit-note phase delivered after a later one", async () => {
    const suffix = randomUUID();
    const fixture = await creditNote(suffix);
    const later = await verifiedEvent(
      creditNoteEvent(fixture, `${suffix}-later`, "credit_note.updated", {
        status: "issued",
        occurredAt: "2032-01-10T00:00:01.000Z",
      }),
    );
    const earlier = await verifiedEvent(
      creditNoteEvent(fixture, `${suffix}-earlier`, "credit_note.created", {
        status: "draft",
        occurredAt: "2032-01-10T00:00:00.000Z",
      }),
    );

    await projection.apply(later);
    await expect(projection.apply(earlier)).resolves.toBeUndefined();

    await expect(
      readCreditNote(fixture, `later-first-${suffix}`),
    ).resolves.toMatchObject({ status: "issued" });
    const traced = await expectTraced(
      [later.eventId, earlier.eventId],
      `cn-later-first-${suffix}`,
    );
    expect(traced.get(earlier.eventId)).toEqual([SUBSUMED]);
  });

  // Stripe stamps `created` to the second, so the pair that opens a credit note
  // shares one. Arriving in the other order the second event restates an
  // earlier phase — not a contradiction, and not a reason to dead-letter a
  // money document forever.
  it("traces rather than refuses a same-second earlier phase", async () => {
    const suffix = randomUUID();
    const fixture = await creditNote(suffix);
    const issued = await verifiedEvent(
      creditNoteEvent(fixture, `${suffix}-issued`, "credit_note.updated", {
        status: "issued",
        occurredAt: "2032-01-11T00:00:00.000Z",
      }),
    );
    const created = await verifiedEvent(
      creditNoteEvent(fixture, `${suffix}-created`, "credit_note.created", {
        status: "draft",
        occurredAt: "2032-01-11T00:00:00.000Z",
      }),
    );

    await projection.apply(issued);
    await expect(projection.apply(created)).resolves.toBeUndefined();

    await expect(
      readCreditNote(fixture, `same-second-${suffix}`),
    ).resolves.toMatchObject({ status: "issued" });
    const traced = await expectTraced(
      [created.eventId],
      `cn-same-second-${suffix}`,
    );
    expect(traced.get(created.eventId)).toEqual([SUBSUMED]);
  });

  // A same-second redelivery of the phase the row already holds has nothing to
  // write. The persisted projection rule forbids a no-op update, so the event
  // must be recorded rather than pushed at the row and dead-lettered.
  it("traces a same-second restatement of the phase already held", async () => {
    const suffix = randomUUID();
    const fixture = await creditNote(suffix);
    const issued = await verifiedEvent(
      creditNoteEvent(fixture, `${suffix}-issued-a`, "credit_note.updated", {
        status: "issued",
        occurredAt: "2032-01-11T00:00:10.000Z",
      }),
    );
    const restated = await verifiedEvent(
      creditNoteEvent(fixture, `${suffix}-issued-b`, "credit_note.updated", {
        status: "issued",
        occurredAt: "2032-01-11T00:00:10.000Z",
      }),
    );

    await projection.apply(issued);
    await expect(projection.apply(restated)).resolves.toBeUndefined();

    await expect(
      readCreditNote(fixture, `restated-${suffix}`),
    ).resolves.toMatchObject({
      status: "issued",
      stripeLastEventId: issued.eventId,
    });
    const traced = await expectTraced(
      [restated.eventId],
      `cn-restated-${suffix}`,
    );
    expect(traced.get(restated.eventId)).toEqual([SUBSUMED]);
  });

  it("still refuses a provider outcome that contradicts a recorded failure", async () => {
    const suffix = randomUUID();
    const fixture = await creditNote(suffix, { status: "failed" });
    const voided = await verifiedEvent(
      creditNoteEvent(fixture, `${suffix}-void`, "credit_note.voided", {
        status: "void",
        occurredAt: "2032-01-12T00:00:00.000Z",
      }),
    );

    await expect(projection.apply(voided)).rejects.toThrow(
      /credit-note terminal status conflicted/i,
    );
    await expect(
      readCreditNote(fixture, `conflict-${suffix}`),
    ).resolves.toMatchObject({ status: "failed" });
  });

  it("lands both same-second credit notes issued against one invoice", async () => {
    const suffix = randomUUID();
    const invoice = await openInvoice(`cn-pair-${suffix}`);
    const half = invoice.amountMinor / 2n;
    const one = await creditNote(`${suffix}-one`, {
      invoice,
      amountMinor: half,
    });
    const two = await creditNote(`${suffix}-two`, {
      invoice,
      amountMinor: invoice.amountMinor - half,
    });
    const sameSecond = "2032-01-13T00:00:00.000Z";
    const first = await verifiedEvent(
      creditNoteEvent(two, `${suffix}-two-issued`, "credit_note.updated", {
        status: "issued",
        occurredAt: sameSecond,
      }),
    );
    const second = await verifiedEvent(
      creditNoteEvent(one, `${suffix}-one-issued`, "credit_note.updated", {
        status: "issued",
        occurredAt: sameSecond,
      }),
    );

    await projection.apply(first);
    await projection.apply(second);

    await expect(
      readCreditNote(one, `pair-one-${suffix}`),
    ).resolves.toMatchObject({ status: "issued" });
    await expect(
      readCreditNote(two, `pair-two-${suffix}`),
    ).resolves.toMatchObject({ status: "issued" });
  });
});

// ---------------------------------------------------------------------------
// refund
// ---------------------------------------------------------------------------

interface RefundFixture {
  readonly refundId: string;
  readonly providerRefundId: string;
  readonly paymentIntentId: string;
  readonly invoice: OpenInvoice;
  readonly amountMinor: bigint;
}

async function refund(
  suffix: string,
  options: {
    status?: string;
    payment?: SettledPayment;
    amountMinor?: bigint;
  } = {},
): Promise<RefundFixture> {
  const payment =
    options.payment ??
    (await settledPayment(
      await openInvoice(`re-${suffix}`),
      `refund-${suffix}`,
    ));
  const amountMinor = options.amountMinor ?? payment.invoice.amountMinor;
  const providerRefundId = `re_${prefix}${suffix}`;
  return internal(`${prefix}refund-${suffix}`, async (transaction) => {
    const [row] = await transaction
      .insert(refunds)
      .values({
        paymentId: payment.paymentId,
        orderId,
        stripeRefundId: providerRefundId,
        currency: payment.invoice.currency,
        amountMinor,
        reasonCode: "customer_request",
        status: options.status ?? "pending",
      })
      .returning();
    if (!row) throw new Error("Refund fixture is missing");
    return {
      refundId: row.id,
      providerRefundId,
      paymentIntentId: payment.paymentIntentId,
      invoice: payment.invoice,
      amountMinor,
    };
  });
}

function refundEvent(
  fixture: RefundFixture,
  suffix: string,
  eventType: string,
  detail: { status: string; occurredAt: string },
): StripeFinancialProjectionEvent {
  return {
    eventId: `${prefix}${suffix}`,
    eventType,
    category: "refund",
    aggregateKey: fixture.providerRefundId,
    occurredAt: detail.occurredAt,
    paymentIntentId: fixture.paymentIntentId,
    refundId: fixture.providerRefundId,
    amount: {
      currency: fixture.invoice.currency,
      minor: fixture.amountMinor.toString(),
    },
    status: detail.status,
  };
}

function readRefund(fixture: RefundFixture, label: string) {
  return internal(`${prefix}read-re-${label}`, (transaction) =>
    transaction.query.refunds.findFirst({
      where: eq(refunds.id, fixture.refundId),
    }),
  );
}

describe("Stripe projection ordering by category: refund", () => {
  it("keeps the later phase and traces a same-second sibling delivered behind it", async () => {
    const suffix = randomUUID();
    const fixture = await refund(suffix);
    const first = await verifiedEvent(
      refundEvent(fixture, `${suffix}-a`, "refund.created", {
        status: "pending",
        occurredAt: "2032-01-14T00:00:00.000Z",
      }),
    );
    const later = await verifiedEvent(
      refundEvent(fixture, `${suffix}-c`, "refund.updated", {
        status: "succeeded",
        occurredAt: "2032-01-14T00:00:05.000Z",
      }),
    );
    const sibling = await verifiedEvent(
      refundEvent(fixture, `${suffix}-b`, "refund.updated", {
        status: "pending",
        occurredAt: "2032-01-14T00:00:00.000Z",
      }),
    );

    await projection.apply(first);
    await projection.apply(later);
    await expect(projection.apply(sibling)).resolves.toBeUndefined();

    await expect(
      readRefund(fixture, `straggler-${suffix}`),
    ).resolves.toMatchObject({ status: "succeeded" });
    const traced = await expectTraced(
      [first.eventId, later.eventId, sibling.eventId],
      `re-straggler-${suffix}`,
    );
    expect(traced.get(sibling.eventId)).toEqual([SUBSUMED]);
  });

  it("traces an earlier refund phase delivered after a later one", async () => {
    const suffix = randomUUID();
    const fixture = await refund(suffix);
    const later = await verifiedEvent(
      refundEvent(fixture, `${suffix}-later`, "refund.updated", {
        status: "succeeded",
        occurredAt: "2032-01-15T00:00:01.000Z",
      }),
    );
    const earlier = await verifiedEvent(
      refundEvent(fixture, `${suffix}-earlier`, "refund.updated", {
        status: "pending",
        occurredAt: "2032-01-15T00:00:00.000Z",
      }),
    );

    await projection.apply(later);
    await expect(projection.apply(earlier)).resolves.toBeUndefined();

    await expect(
      readRefund(fixture, `later-first-${suffix}`),
    ).resolves.toMatchObject({ status: "succeeded" });
    const traced = await expectTraced(
      [earlier.eventId],
      `re-later-first-${suffix}`,
    );
    expect(traced.get(earlier.eventId)).toEqual([SUBSUMED]);
  });

  // A refund that settles inside the second it was requested produces two
  // events sharing one `created`. Delivered the other way round the pending
  // restatement is behind, not in conflict with, the settlement.
  it("traces rather than refuses a same-second earlier phase", async () => {
    const suffix = randomUUID();
    const fixture = await refund(suffix);
    const succeeded = await verifiedEvent(
      refundEvent(fixture, `${suffix}-succeeded`, "refund.updated", {
        status: "succeeded",
        occurredAt: "2032-01-16T00:00:00.000Z",
      }),
    );
    const pending = await verifiedEvent(
      refundEvent(fixture, `${suffix}-pending`, "refund.updated", {
        status: "pending",
        occurredAt: "2032-01-16T00:00:00.000Z",
      }),
    );

    await projection.apply(succeeded);
    await expect(projection.apply(pending)).resolves.toBeUndefined();

    await expect(
      readRefund(fixture, `same-second-${suffix}`),
    ).resolves.toMatchObject({ status: "succeeded" });
    const traced = await expectTraced(
      [pending.eventId],
      `re-same-second-${suffix}`,
    );
    expect(traced.get(pending.eventId)).toEqual([SUBSUMED]);
  });

  it("traces a same-second restatement of the phase already held", async () => {
    const suffix = randomUUID();
    const fixture = await refund(suffix);
    const first = await verifiedEvent(
      refundEvent(fixture, `${suffix}-done-a`, "refund.updated", {
        status: "succeeded",
        occurredAt: "2032-01-16T00:00:10.000Z",
      }),
    );
    const restated = await verifiedEvent(
      refundEvent(fixture, `${suffix}-done-b`, "refund.updated", {
        status: "succeeded",
        occurredAt: "2032-01-16T00:00:10.000Z",
      }),
    );

    await projection.apply(first);
    await expect(projection.apply(restated)).resolves.toBeUndefined();

    await expect(
      readRefund(fixture, `restated-${suffix}`),
    ).resolves.toMatchObject({
      status: "succeeded",
      stripeLastEventId: first.eventId,
    });
    const traced = await expectTraced(
      [restated.eventId],
      `re-restated-${suffix}`,
    );
    expect(traced.get(restated.eventId)).toEqual([SUBSUMED]);
  });

  it("still refuses two refund outcomes that disagree", async () => {
    const suffix = randomUUID();
    const fixture = await refund(suffix);
    const succeeded = await verifiedEvent(
      refundEvent(fixture, `${suffix}-ok`, "refund.updated", {
        status: "succeeded",
        occurredAt: "2032-01-17T00:00:00.000Z",
      }),
    );
    const failed = await verifiedEvent(
      refundEvent(fixture, `${suffix}-bad`, "refund.updated", {
        status: "failed",
        occurredAt: "2032-01-17T00:00:00.000Z",
      }),
    );

    await projection.apply(succeeded);
    await expect(projection.apply(failed)).rejects.toThrow(
      /refund terminal status conflicted/i,
    );
    await expect(
      readRefund(fixture, `conflict-${suffix}`),
    ).resolves.toMatchObject({ status: "succeeded" });
  });

  it("lands both same-second refunds against one payment", async () => {
    const suffix = randomUUID();
    const invoice = await openInvoice(`re-pair-${suffix}`);
    const payment = await settledPayment(invoice, `re-pair-${suffix}`);
    const half = invoice.amountMinor / 2n;
    const one = await refund(`${suffix}-one`, { payment, amountMinor: half });
    const two = await refund(`${suffix}-two`, {
      payment,
      amountMinor: invoice.amountMinor - half,
    });
    const sameSecond = "2032-01-18T00:00:00.000Z";
    const first = await verifiedEvent(
      refundEvent(two, `${suffix}-two-done`, "refund.updated", {
        status: "succeeded",
        occurredAt: sameSecond,
      }),
    );
    const second = await verifiedEvent(
      refundEvent(one, `${suffix}-one-done`, "refund.updated", {
        status: "succeeded",
        occurredAt: sameSecond,
      }),
    );

    await projection.apply(first);
    await projection.apply(second);

    await expect(readRefund(one, `pair-one-${suffix}`)).resolves.toMatchObject({
      status: "succeeded",
    });
    await expect(readRefund(two, `pair-two-${suffix}`)).resolves.toMatchObject({
      status: "succeeded",
    });
  });
});

// ---------------------------------------------------------------------------
// dispute
// ---------------------------------------------------------------------------

interface DisputeFixture {
  readonly disputeCaseId: string;
  readonly providerDisputeId: string;
  readonly paymentIntentId: string;
}

async function disputedPayment(
  suffix: string,
  options: { payment?: SettledPayment; amountMinor?: bigint } = {},
): Promise<DisputeFixture> {
  const payment =
    options.payment ??
    (await settledPayment(
      await openInvoice(`dp-${suffix}`),
      `dispute-${suffix}`,
    ));
  const providerDisputeId = `dp_${prefix}${suffix}`;
  return internal(`${prefix}dispute-${suffix}`, async (transaction) => {
    const [row] = await transaction
      .insert(disputeCases)
      .values({
        paymentId: payment.paymentId,
        orderId,
        stripeDisputeId: providerDisputeId,
        currency: payment.invoice.currency,
        amountMinor: options.amountMinor ?? payment.invoice.amountMinor,
        evidenceDueAt: new Date("2032-02-01T00:00:00.000Z"),
        status: "needs_response",
      })
      .returning();
    if (!row) throw new Error("Dispute fixture is missing");
    return {
      disputeCaseId: row.id,
      providerDisputeId,
      paymentIntentId: payment.paymentIntentId,
    };
  });
}

function disputeEvent(
  fixture: DisputeFixture,
  suffix: string,
  eventType: string,
  detail: { status: string; occurredAt: string },
): StripeFinancialProjectionEvent {
  return {
    eventId: `${prefix}${suffix}`,
    eventType,
    category: "dispute",
    aggregateKey: fixture.providerDisputeId,
    occurredAt: detail.occurredAt,
    paymentIntentId: fixture.paymentIntentId,
    disputeId: fixture.providerDisputeId,
    status: detail.status,
  };
}

function readDispute(fixture: DisputeFixture, label: string) {
  return internal(`${prefix}read-dp-${label}`, (transaction) =>
    transaction.query.disputeCases.findFirst({
      where: eq(disputeCases.id, fixture.disputeCaseId),
    }),
  );
}

describe("Stripe projection ordering by category: dispute", () => {
  it("keeps a closed outcome and traces a same-second sibling delivered behind it", async () => {
    const suffix = randomUUID();
    const fixture = await disputedPayment(suffix);
    const first = await verifiedEvent(
      disputeEvent(fixture, `${suffix}-a`, "charge.dispute.updated", {
        status: "under_review",
        occurredAt: "2032-01-19T00:00:00.000Z",
      }),
    );
    const later = await verifiedEvent(
      disputeEvent(fixture, `${suffix}-c`, "charge.dispute.closed", {
        status: "won",
        occurredAt: "2032-01-19T00:00:05.000Z",
      }),
    );
    const sibling = await verifiedEvent(
      disputeEvent(fixture, `${suffix}-b`, "charge.dispute.updated", {
        status: "warning_needs_response",
        occurredAt: "2032-01-19T00:00:00.000Z",
      }),
    );

    await projection.apply(first);
    await projection.apply(later);
    await expect(projection.apply(sibling)).resolves.toBeUndefined();

    await expect(
      readDispute(fixture, `straggler-${suffix}`),
    ).resolves.toMatchObject({ status: "won" });
    await expectTraced(
      [first.eventId, later.eventId, sibling.eventId],
      `dp-straggler-${suffix}`,
    );
  });

  it("traces an earlier dispute phase delivered after a later closure", async () => {
    const suffix = randomUUID();
    const fixture = await disputedPayment(suffix);
    const later = await verifiedEvent(
      disputeEvent(fixture, `${suffix}-later`, "charge.dispute.closed", {
        status: "lost",
        occurredAt: "2032-01-20T00:00:01.000Z",
      }),
    );
    const earlier = await verifiedEvent(
      disputeEvent(fixture, `${suffix}-earlier`, "charge.dispute.created", {
        status: "needs_response",
        occurredAt: "2032-01-20T00:00:00.000Z",
      }),
    );

    await projection.apply(later);
    await expect(projection.apply(earlier)).resolves.toBeUndefined();

    await expect(
      readDispute(fixture, `later-first-${suffix}`),
    ).resolves.toMatchObject({ status: "lost" });
    await expectTraced(
      [later.eventId, earlier.eventId],
      `dp-later-first-${suffix}`,
    );
  });

  it("lands both same-second disputes raised against one payment", async () => {
    const suffix = randomUUID();
    const invoice = await openInvoice(`dp-pair-${suffix}`);
    const payment = await settledPayment(invoice, `dp-pair-${suffix}`);
    const half = invoice.amountMinor / 2n;
    const one = await disputedPayment(`${suffix}-one`, {
      payment,
      amountMinor: half,
    });
    const two = await disputedPayment(`${suffix}-two`, {
      payment,
      amountMinor: invoice.amountMinor - half,
    });
    const sameSecond = "2032-01-21T00:00:00.000Z";
    const first = await verifiedEvent(
      disputeEvent(two, `${suffix}-two-closed`, "charge.dispute.closed", {
        status: "won",
        occurredAt: sameSecond,
      }),
    );
    const second = await verifiedEvent(
      disputeEvent(one, `${suffix}-one-closed`, "charge.dispute.closed", {
        status: "lost",
        occurredAt: sameSecond,
      }),
    );

    await projection.apply(first);
    await projection.apply(second);

    await expect(readDispute(one, `pair-one-${suffix}`)).resolves.toMatchObject(
      { status: "lost" },
    );
    await expect(readDispute(two, `pair-two-${suffix}`)).resolves.toMatchObject(
      { status: "won" },
    );
  });
});

// ---------------------------------------------------------------------------
// customer / subscription / subscription_schedule / tax / other
// ---------------------------------------------------------------------------

const nonFinancial = [
  { category: "customer", eventType: "customer.updated" },
  { category: "subscription", eventType: "customer.subscription.updated" },
  {
    category: "subscription_schedule",
    eventType: "subscription_schedule.updated",
  },
  { category: "tax", eventType: "tax.settings.updated" },
  { category: "other", eventType: "charge.updated" },
] as const;

describe("Stripe projection ordering by category: non-financial", () => {
  it.each(nonFinancial)(
    "records every $category sibling whatever the delivery order",
    async ({ category, eventType }) => {
      const suffix = randomUUID();
      const aggregateKey = `${prefix}${category}-${suffix}`;
      const at = (offset: number, label: string) =>
        verifiedEvent({
          eventId: `${prefix}${suffix}-${label}`,
          eventType,
          category,
          aggregateKey,
          occurredAt: `2032-01-22T00:00:0${offset}.000Z`,
        });
      const first = await at(0, "a");
      const later = await at(5, "c");
      const sibling = await at(0, "b");

      await projection.apply(first);
      await projection.apply(later);
      await projection.apply(sibling);

      const traced = await expectTraced(
        [first.eventId, later.eventId, sibling.eventId],
        `${category}-${suffix}`,
      );
      for (const eventId of [first.eventId, later.eventId, sibling.eventId])
        expect(traced.get(eventId)).toEqual([
          "verified_no_financial_projection",
        ]);
    },
  );
});
