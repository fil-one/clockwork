import { randomUUID } from "node:crypto";

import { and, eq, inArray, like, or } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { IdempotencyKeySchema, ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";

import { createRuntimeDatabase, type RuntimeTransaction } from "../../client";
import {
  auditEvents,
  invoices,
  orders,
  outboxMessages,
  payments,
  providerOperations,
  webhookEvents,
} from "../../schema";
import { providerProjectionCheckpoints } from "../../schema/system";
import { withInternalTransaction } from "../../transaction";
import { DatabaseCoreFinanceRepository } from "../core/database-finance";
import { DatabaseCoreWorkflowRecordPort } from "../workflows/core";
import {
  DatabaseStripeFinancialProjection,
  type StripeFinancialProjectionEvent,
} from "./providers";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";
const prefix = "integration-stripe-payment-binding-";
const accountId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000002";
const orderId = "80000000-0000-4000-8000-000000000001";
const customerId = `cus_demo_${accountId.replaceAll("-", "")}`;

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 10,
  role: "clockwork_service",
  ssl: false,
});
const finance = new DatabaseCoreFinanceRepository({
  database: db,
  pricingDatabase: db,
  authorizationSecret,
});
const workflowRecords = new DatabaseCoreWorkflowRecordPort(db);
const projection = new DatabaseStripeFinancialProjection(db);
const authorization: AuthorizationContext = {
  userId: ids.user.parse(userId),
  accountIds: [ids.account.parse(accountId)],
  roles: ["owner"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

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
    await transaction
      .delete(providerOperations)
      .where(like(providerOperations.idempotencyKey, `${prefix}%`));
    if (invoiceIds.length) {
      await transaction
        .delete(payments)
        .where(inArray(payments.invoiceId, invoiceIds));
      await transaction
        .delete(invoices)
        .where(inArray(invoices.id, invoiceIds));
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
  const draft = await finance.mutate({
    resource: "invoices",
    id: invoiceId,
    accountId,
    action: "create",
    payload: { orderId, dueAt: "2031-02-01T00:00:00.000Z" },
    actor: { kind: "user", id: userId },
    authorization,
    requestId: `${prefix}draft-${suffix}`,
    idempotencyKey: `${prefix}draft-${suffix}`,
    occurredAt: "2031-01-01T00:00:00.000Z",
  });
  const truth = await internal(
    `${prefix}truth-${suffix}`,
    async (transaction) => {
      const [invoice, order] = await Promise.all([
        transaction.query.invoices.findFirst({
          where: eq(invoices.id, invoiceId),
        }),
        transaction.query.orders.findFirst({ where: eq(orders.id, orderId) }),
      ]);
      if (!invoice || !order)
        throw new Error("Issued-invoice fixture is missing");
      return { invoice, order };
    },
  );
  const providerInvoiceId = `in_${prefix}${suffix}`;
  await workflowRecords.record({
    invocationKey: IdempotencyKeySchema.parse(`${prefix}issue-${suffix}`),
    aggregateId: invoiceId,
    aggregateVersion: draft.record.rowVersion,
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
    amountMinor: truth.invoice.amountMinor.toString(),
  };
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
      payloadHash: "a".repeat(64),
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

function paidEvent(
  invoice: Awaited<ReturnType<typeof createIssuedInvoice>>,
  suffix: string,
  eventType: "invoice.paid" | "payment_intent.succeeded",
  occurredAt: string,
): StripeFinancialProjectionEvent & {
  invoiceId: string;
  paymentIntentId: string;
  amount: { currency: string; minor: string };
} {
  return {
    eventId: `${prefix}${suffix}`,
    eventType,
    category: eventType === "invoice.paid" ? "invoice" : "payment",
    aggregateKey: invoice.providerInvoiceId,
    occurredAt,
    invoiceId: invoice.providerInvoiceId,
    paymentIntentId: `pi_${prefix}${suffix}`,
    customerId,
    amount: { currency: invoice.currency, minor: invoice.amountMinor },
    status: "succeeded",
  };
}

// Each case owns unique local/provider invoice and payment identifiers.
describe.concurrent("Stripe payment creation and binding", () => {
  it("creates and binds payment truth from a verified invoice.paid event", async () => {
    const suffix = randomUUID();
    const invoice = await createIssuedInvoice(suffix);
    const event = await verifiedEvent(
      paidEvent(invoice, suffix, "invoice.paid", "2031-01-01T00:02:00.000Z"),
    );
    await projection.apply(event);
    await projection.apply(event);

    const persisted = await internal(
      `${prefix}inspect-${suffix}`,
      async (transaction) => {
        const [invoiceRow, paymentRows] = await Promise.all([
          transaction.query.invoices.findFirst({
            where: eq(invoices.id, invoice.invoiceId),
          }),
          transaction.query.payments.findMany({
            where: eq(payments.invoiceId, invoice.invoiceId),
          }),
        ]);
        return { invoiceRow, paymentRows };
      },
    );
    expect(persisted.invoiceRow).toMatchObject({
      status: "paid",
      stripeLastEventId: event.eventId,
      rowVersion: 3,
    });
    expect(persisted.paymentRows).toHaveLength(1);
    expect(persisted.paymentRows[0]).toMatchObject({
      orderId,
      stripePaymentIntentId: event.paymentIntentId,
      currency: invoice.currency,
      amountMinor: BigInt(invoice.amountMinor),
      status: "succeeded",
      stripeLastEventId: event.eventId,
      rowVersion: 1,
    });
  });

  it("creates payment from payment_intent and ignores a delayed failure", async () => {
    const suffix = randomUUID();
    const invoice = await createIssuedInvoice(suffix);
    const succeeded = await verifiedEvent(
      paidEvent(
        invoice,
        `${suffix}-succeeded`,
        "payment_intent.succeeded",
        "2031-01-01T00:03:00.000Z",
      ),
    );
    await projection.apply(succeeded);
    const delayed = await verifiedEvent({
      ...succeeded,
      eventId: `${prefix}${suffix}-delayed-failure`,
      eventType: "payment_intent.payment_failed",
      occurredAt: "2031-01-01T00:02:00.000Z",
      status: "requires_payment_method",
    });
    await projection.apply(delayed);

    const persisted = await internal(
      `${prefix}stale-${suffix}`,
      async (transaction) => ({
        invoice: await transaction.query.invoices.findFirst({
          where: eq(invoices.id, invoice.invoiceId),
        }),
        payment: await transaction.query.payments.findFirst({
          where: eq(payments.stripePaymentIntentId, succeeded.paymentIntentId),
        }),
      }),
    );
    expect(persisted.invoice).toMatchObject({
      status: "paid",
      stripeLastEventId: succeeded.eventId,
    });
    expect(persisted.payment).toMatchObject({
      status: "succeeded",
      stripeLastEventId: succeeded.eventId,
    });
  });

  it("rejects amount, currency, invoice, and order rebinding mismatches", async () => {
    const suffix = randomUUID();
    const first = await createIssuedInvoice(`${suffix}-first`);
    const second = await createIssuedInvoice(`${suffix}-second`);
    const succeeded = await verifiedEvent(
      paidEvent(
        first,
        `${suffix}-base`,
        "payment_intent.succeeded",
        "2031-01-01T00:02:00.000Z",
      ),
    );
    await projection.apply(succeeded);

    const wrongAmount = await verifiedEvent({
      ...succeeded,
      eventId: `${prefix}${suffix}-wrong-amount`,
      occurredAt: "2031-01-01T00:03:00.000Z",
      amount: {
        currency: first.currency,
        minor: (BigInt(first.amountMinor) + 1n).toString(),
      },
    });
    await expect(projection.apply(wrongAmount)).rejects.toThrow(
      "Stripe payment invoice, order, amount, or currency mismatch",
    );

    const wrongCurrency = await verifiedEvent({
      ...succeeded,
      eventId: `${prefix}${suffix}-wrong-currency`,
      occurredAt: "2031-01-01T00:04:00.000Z",
      amount: { currency: "EUR", minor: first.amountMinor },
    });
    await expect(projection.apply(wrongCurrency)).rejects.toThrow(
      "Stripe invoice currency mismatch",
    );

    const wrongInvoice = await verifiedEvent({
      ...succeeded,
      eventId: `${prefix}${suffix}-wrong-invoice`,
      aggregateKey: second.providerInvoiceId,
      occurredAt: "2031-01-01T00:05:00.000Z",
      invoiceId: second.providerInvoiceId,
      amount: { currency: second.currency, minor: second.amountMinor },
    });
    await expect(projection.apply(wrongInvoice)).rejects.toThrow(
      "invoice, order, amount, or currency mismatch",
    );

    const payment = await internal(
      `${prefix}conflict-${suffix}`,
      (transaction) =>
        transaction.query.payments.findFirst({
          where: eq(payments.stripePaymentIntentId, succeeded.paymentIntentId),
        }),
    );
    expect(payment).toMatchObject({
      invoiceId: first.invoiceId,
      orderId,
      status: "succeeded",
      rowVersion: 1,
    });
  });

  it("refuses unsigned normalized events before any financial mutation", async () => {
    const suffix = randomUUID();
    const invoice = await createIssuedInvoice(suffix);
    const event = paidEvent(
      invoice,
      `${suffix}-unsigned`,
      "invoice.paid",
      "2031-01-01T00:02:00.000Z",
    );
    await expect(projection.apply(event)).rejects.toThrow(
      "Verified Stripe inbox event is missing",
    );
    const row = await internal(`${prefix}unsigned-${suffix}`, (transaction) =>
      transaction.query.invoices.findFirst({
        where: eq(invoices.id, invoice.invoiceId),
      }),
    );
    expect(row).toMatchObject({ status: "open", rowVersion: 2 });
  });
});
