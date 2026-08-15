import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, like, or } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { IdempotencyKeySchema } from "@clockwork/contracts";

import { createRuntimeDatabase, type RuntimeTransaction } from "../../client";
import {
  auditEvents,
  invoices,
  orders,
  outboxMessages,
  payments,
  quotes,
  webhookEvents,
} from "../../schema";
import { collectionActions, collectionCases } from "../../schema/core/finance";
import { providerProjectionCheckpoints } from "../../schema/system";
import { withInternalTransaction } from "../../transaction";
import { DatabaseCoreWorkflowRecordPort } from "../workflows/core";
import {
  DatabaseStripeFinancialProjection,
  type StripeFinancialProjectionEvent,
} from "./providers";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const prefix = "integration-stripe-partial-payment-";
const accountId = "10000000-0000-4000-8000-000000000001";
const collectionsOwnerId = "20000000-0000-4000-8000-000000000001";
const orderId = "80000000-0000-4000-8000-000000000001";
const customerId = `cus_demo_${accountId.replaceAll("-", "")}`;

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 10,
  role: "clockwork_service",
  ssl: false,
});
const workflowRecords = new DatabaseCoreWorkflowRecordPort(db);
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
      .select({
        id: auditEvents.id,
        aggregateId: auditEvents.aggregateId,
        aggregateType: auditEvents.aggregateType,
      })
      .from(auditEvents)
      .where(
        or(
          like(auditEvents.requestId, `${prefix}%`),
          like(auditEvents.requestId, `stripe:${prefix}%`),
        ),
      );
    const eventIds = events.map((event) => event.id);
    const invoiceIds = events
      .filter((event) => event.aggregateType === "invoice")
      .map((event) => event.aggregateId);
    if (eventIds.length)
      await transaction
        .delete(outboxMessages)
        .where(inArray(outboxMessages.eventId, eventIds));
    if (invoiceIds.length) {
      // Collection actions are append-only, so an invoice that reached a
      // collection case stays behind with it. Every fixture identity is unique
      // per run, so the leftovers never collide with a later one.
      const cases = await transaction
        .select({ invoiceId: collectionCases.invoiceId })
        .from(collectionCases)
        .where(inArray(collectionCases.invoiceId, invoiceIds));
      const retained = new Set(cases.map((row) => row.invoiceId));
      const removable = invoiceIds.filter((id) => !retained.has(id));
      if (removable.length) {
        await transaction
          .delete(payments)
          .where(inArray(payments.invoiceId, removable));
        await transaction
          .delete(invoices)
          .where(inArray(invoices.id, removable));
      }
    }
    if (eventIds.length)
      await transaction
        .delete(auditEvents)
        .where(inArray(auditEvents.id, eventIds));
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
          like(providerProjectionCheckpoints.aggregateKey, `in_${prefix}%`),
        ),
      );
  });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await client.end();
});

async function createIssuedInvoice(suffix: string) {
  const invoiceId = randomUUID();
  // Five cases need five independent invoices, and `invoices: create` now
  // derives one identifier per order, so the fixture writes the row itself
  // rather than billing the shared order five times through the writer. What
  // it writes is still the order's own commercial truth, which is all the
  // projection trigger (000920, rewritten at 001390) will accept.
  const truth = await internal(
    `${prefix}truth-${suffix}`,
    async (transaction) => {
      const order = await transaction.query.orders.findFirst({
        where: eq(orders.id, orderId),
      });
      const quote = order
        ? await transaction.query.quotes.findFirst({
            where: eq(quotes.id, order.quoteId),
          })
        : undefined;
      if (!order || !quote)
        throw new Error("Issued-invoice fixture is missing");
      const [invoice] = await transaction
        .insert(invoices)
        .values({
          id: invoiceId,
          orderId: order.id,
          accountId: order.invoicingAccountId,
          stripeInvoiceId: null,
          currency: quote.currency,
          amountMinor: quote.totalMinor,
          poNumber: order.poNumber,
          status: "draft",
          dueAt: new Date("2031-02-01T00:00:00.000Z"),
        })
        .returning();
      if (!invoice) throw new Error("Issued-invoice fixture is missing");
      return { invoice, order };
    },
  );
  const providerInvoiceId = `in_${prefix}${suffix}`;
  await workflowRecords.record({
    invocationKey: IdempotencyKeySchema.parse(`${prefix}issue-${suffix}`),
    aggregateId: invoiceId,
    aggregateVersion: truth.invoice.rowVersion,
    requestId: `${prefix}issue-${suffix}`,
    occurredAt: "2031-01-01T00:01:00.000Z",
    record: {
      kind: "invoice_issued",
      taskId: "core.billing.issue-invoice.v1",
      input: {
        invoiceId,
        orderId,
        billingAccountId: accountId,
        customerId,
        commercialShape: truth.order.sourcing,
        collectionMethod: "auto_charge",
        amount: {
          currency: truth.invoice.currency,
          minor: truth.invoice.amountMinor.toString(),
        },
        ...(truth.invoice.poNumber ? { poNumber: truth.invoice.poNumber } : {}),
      },
      providerInvoiceId,
      providerStatus: "open",
    },
  });
  return {
    invoiceId,
    providerInvoiceId,
    currency: truth.invoice.currency,
    amountMinor: BigInt(truth.invoice.amountMinor),
  };
}

type IssuedInvoice = Awaited<ReturnType<typeof createIssuedInvoice>>;

async function openCollectionCase(invoice: IssuedInvoice): Promise<string> {
  return internal(`${prefix}case-${invoice.invoiceId}`, async (transaction) => {
    const [row] = await transaction
      .insert(collectionCases)
      .values({
        invoiceId: invoice.invoiceId,
        accountId,
        ownerUserId: collectionsOwnerId,
        agingBucket: "first_threshold",
        nextActionAt: new Date("2031-02-08T00:00:00.000Z"),
        status: "escalated",
        newServiceBlocked: true,
        runningServiceDecision: "human_review",
      })
      .returning();
    if (!row) throw new Error("Collection case fixture is missing");
    return row.id;
  });
}

async function verifiedEvent<Event extends StripeFinancialProjectionEvent>(
  event: Event,
): Promise<Event> {
  await internal(`${prefix}webhook-${event.eventId}`, async (transaction) => {
    await transaction.insert(webhookEvents).values({
      provider: "stripe",
      providerEventId: event.eventId,
      eventType: event.eventType,
      signatureVerifiedAt: new Date(event.occurredAt),
      payloadHash: "b".repeat(64),
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
  invoice: IssuedInvoice,
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
    customerId,
    amount: { currency: invoice.currency, minor: minor.toString() },
    status: "succeeded",
  };
}

/** An invoice event that states the provider totals. */
function invoiceEvent(
  invoice: IssuedInvoice,
  suffix: string,
  totals: { due: bigint; paid: bigint; remaining: bigint },
  occurredAt: string,
): StripeFinancialProjectionEvent {
  const money = (minor: bigint) => ({
    currency: invoice.currency,
    minor: minor.toString(),
  });
  return {
    eventId: `${prefix}${suffix}`,
    eventType: "invoice.payment_succeeded",
    category: "invoice",
    aggregateKey: invoice.providerInvoiceId,
    occurredAt,
    invoiceId: invoice.providerInvoiceId,
    paymentIntentId: `pi_${prefix}${suffix}`,
    customerId,
    amount: money(totals.paid),
    amountDue: money(totals.due),
    amountPaid: money(totals.paid),
    amountRemaining: money(totals.remaining),
    status: "open",
  };
}

function readInvoice(invoice: IssuedInvoice, label: string) {
  return internal(`${prefix}read-${label}`, async (transaction) => ({
    invoice: await transaction.query.invoices.findFirst({
      where: eq(invoices.id, invoice.invoiceId),
    }),
    payments: await transaction.query.payments.findMany({
      where: eq(payments.invoiceId, invoice.invoiceId),
      orderBy: [asc(payments.amountMinor)],
    }),
    collectionCase: await transaction.query.collectionCases.findFirst({
      where: eq(collectionCases.invoiceId, invoice.invoiceId),
    }),
  }));
}

function readCollectionActions(collectionCaseId: string, label: string) {
  return internal(`${prefix}actions-${label}`, (transaction) =>
    transaction.query.collectionActions.findMany({
      where: eq(collectionActions.collectionCaseId, collectionCaseId),
      orderBy: [asc(collectionActions.occurredAt)],
    }),
  );
}

describe("Stripe partial payment projection", () => {
  it("records a short payment and keeps the invoice collectable", async () => {
    const suffix = randomUUID();
    const invoice = await createIssuedInvoice(suffix);
    const caseId = await openCollectionCase(invoice);
    await projection.apply(
      await verifiedEvent(
        intentEvent(
          invoice,
          `${suffix}-short`,
          60_000n,
          "2031-01-02T00:00:00.000Z",
        ),
      ),
    );

    const state = await readInvoice(invoice, `short-${suffix}`);
    expect(state.invoice).toMatchObject({
      status: "open",
      amountPaidMinor: 60_000n,
      amountRemainingMinor: invoice.amountMinor - 60_000n,
      paidAt: null,
    });
    expect(state.payments).toHaveLength(1);
    expect(state.payments[0]).toMatchObject({
      status: "succeeded",
      amountMinor: 60_000n,
    });
    expect(state.collectionCase).toMatchObject({ status: "escalated" });
    expect(await readCollectionActions(caseId, `short-${suffix}`)).toEqual([]);
  });

  it("settles across installments and resolves the collection case once", async () => {
    const suffix = randomUUID();
    const invoice = await createIssuedInvoice(suffix);
    const caseId = await openCollectionCase(invoice);
    const first = await verifiedEvent(
      intentEvent(
        invoice,
        `${suffix}-first`,
        60_000n,
        "2031-01-02T00:00:00.000Z",
      ),
    );
    const second = await verifiedEvent(
      intentEvent(
        invoice,
        `${suffix}-second`,
        invoice.amountMinor - 60_000n,
        "2031-01-03T00:00:00.000Z",
      ),
    );
    await projection.apply(first);
    const midway = await readInvoice(invoice, `midway-${suffix}`);
    expect(midway.invoice).toMatchObject({
      status: "open",
      amountPaidMinor: 60_000n,
    });

    await projection.apply(second);
    await projection.apply(second);

    const settled = await readInvoice(invoice, `settled-${suffix}`);
    expect(settled.invoice).toMatchObject({
      status: "paid",
      amountPaidMinor: invoice.amountMinor,
      amountRemainingMinor: 0n,
    });
    expect(settled.invoice?.paidAt).not.toBeNull();
    expect(settled.payments).toHaveLength(2);
    expect(settled.collectionCase).toMatchObject({
      status: "resolved",
      newServiceBlocked: false,
      runningServiceDecision: "continue",
    });
    const actions = await readCollectionActions(caseId, `settled-${suffix}`);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      action: "invoice_settled",
      actorUserId: collectionsOwnerId,
      outcome: "resolved",
    });
  });

  it("accepts an overpayment and floors the outstanding amount at zero", async () => {
    const suffix = randomUUID();
    const invoice = await createIssuedInvoice(suffix);
    await projection.apply(
      await verifiedEvent(
        intentEvent(
          invoice,
          `${suffix}-over`,
          invoice.amountMinor + 5_000n,
          "2031-01-02T00:00:00.000Z",
        ),
      ),
    );

    const state = await readInvoice(invoice, `over-${suffix}`);
    expect(state.invoice).toMatchObject({
      status: "paid",
      amountPaidMinor: invoice.amountMinor + 5_000n,
      amountRemainingMinor: 0n,
    });
  });

  /**
   * A stale restatement of the invoice's running total must not lower the
   * settled amount.
   *
   * The two events deliberately carry the SAME payment intent, because that is
   * what "an earlier event arrives late" means for one settlement: Stripe is
   * restating the same intent's effect on the invoice, not reporting a second
   * payment. The fixture previously derived the intent id from the event
   * suffix, so the two events named DIFFERENT intents and the test quietly
   * asserted that a distinct intent's money produces no payments row — which is
   * the invoice-category money loss fixed alongside this. Distinct intents are
   * covered by the installment cases in stripe-category-ordering.
   */
  it("holds the settled amount when an earlier event arrives late", async () => {
    const suffix = randomUUID();
    const invoice = await createIssuedInvoice(suffix);
    const settlement = invoiceEvent(
      invoice,
      `${suffix}-settlement`,
      {
        due: invoice.amountMinor,
        paid: invoice.amountMinor,
        remaining: 0n,
      },
      "2031-01-04T00:00:00.000Z",
    );
    await projection.apply(await verifiedEvent(settlement));
    await projection.apply(
      await verifiedEvent({
        ...settlement,
        eventId: `${settlement.eventId}-late`,
        occurredAt: "2031-01-03T00:00:00.000Z",
        // `amount` is the intent's own money and never changes for one intent —
        // projectBoundPayment refuses a conflicting restatement. What is stale
        // here is the invoice-level running total the event carries.
        amountPaid: { currency: invoice.currency, minor: "60000" },
        amountRemaining: {
          currency: invoice.currency,
          minor: (invoice.amountMinor - 60_000n).toString(),
        },
      }),
    );

    const state = await readInvoice(invoice, `late-${suffix}`);
    expect(state.invoice).toMatchObject({
      status: "paid",
      amountPaidMinor: invoice.amountMinor,
      amountRemainingMinor: 0n,
    });
    expect(state.payments).toHaveLength(1);
  });

  it("dead-letters invoice totals that do not reconcile", async () => {
    const suffix = randomUUID();
    const invoice = await createIssuedInvoice(suffix);
    const unbalanced = await verifiedEvent(
      invoiceEvent(
        invoice,
        `${suffix}-unbalanced`,
        { due: invoice.amountMinor, paid: 60_000n, remaining: 60_000n },
        "2031-01-02T00:00:00.000Z",
      ),
    );
    await expect(projection.apply(unbalanced)).rejects.toThrow(
      "Stripe invoice paid and remaining do not reconcile",
    );

    const wrongTotal = await verifiedEvent(
      invoiceEvent(
        invoice,
        `${suffix}-wrong-total`,
        {
          due: invoice.amountMinor + 1n,
          paid: 60_000n,
          remaining: invoice.amountMinor + 1n - 60_000n,
        },
        "2031-01-03T00:00:00.000Z",
      ),
    );
    await expect(projection.apply(wrongTotal)).rejects.toThrow(
      "Stripe invoice total does not match the persisted total",
    );

    const state = await readInvoice(invoice, `unbalanced-${suffix}`);
    expect(state.invoice).toMatchObject({
      status: "open",
      amountPaidMinor: 0n,
      amountRemainingMinor: invoice.amountMinor,
    });
    expect(state.payments).toEqual([]);
  });
});
