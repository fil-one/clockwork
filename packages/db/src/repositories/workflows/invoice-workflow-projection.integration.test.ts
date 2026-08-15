import { randomUUID } from "node:crypto";

import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { IdempotencyKeySchema } from "@clockwork/contracts";

import { createRuntimeDatabase, type RuntimeTransaction } from "../../client";
import {
  auditEvents,
  invoices,
  orders,
  outboxMessages,
  providerOperations,
  quotes,
} from "../../schema";
import { withInternalTransaction } from "../../transaction";
import { DatabaseCoreWorkflowRecordPort } from "./core";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const prefix = "integration-invoice-workflow-";
const accountId = "10000000-0000-4000-8000-000000000001";
const orderId = "80000000-0000-4000-8000-000000000001";

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 8,
  role: "clockwork_service",
  ssl: false,
});
const records = new DatabaseCoreWorkflowRecordPort(db);

function internal<T>(
  requestId: string,
  operation: (transaction: RuntimeTransaction) => Promise<T>,
): Promise<T> {
  return withInternalTransaction(db, requestId, operation);
}

// Rows written straight into `invoices` carry no audit event of their own, and
// the case that rolls its projection back never writes one either, so the
// fixture remembers them rather than leaving them on the shared order.
const insertedInvoiceIds: string[] = [];

async function cleanup(): Promise<void> {
  await internal(`${prefix}cleanup`, async (transaction) => {
    const events = await transaction
      .select({ id: auditEvents.id, aggregateId: auditEvents.aggregateId })
      .from(auditEvents)
      .where(like(auditEvents.requestId, `${prefix}%`));
    const eventIds = events.map((event) => event.id);
    const invoiceIds = [
      ...new Set([
        ...events.map((event) => event.aggregateId),
        ...insertedInvoiceIds,
      ]),
    ];
    if (eventIds.length)
      await transaction
        .delete(outboxMessages)
        .where(inArray(outboxMessages.eventId, eventIds));
    await transaction
      .delete(providerOperations)
      .where(like(providerOperations.idempotencyKey, `${prefix}%`));
    if (invoiceIds.length)
      await transaction
        .delete(invoices)
        .where(inArray(invoices.id, invoiceIds));
    if (eventIds.length)
      await transaction
        .delete(auditEvents)
        .where(inArray(auditEvents.id, eventIds));
  });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await client.end();
});

// The cases here only need an invoice to project onto, and one order now has
// one invoice identifier, so they write the row rather than billing the shared
// order once per case through `invoices: create`. The row still states the
// order's own commercial truth, which is all the projection trigger (000920,
// rewritten at 001390) will accept. What that writer derives from the order is
// covered where a fresh order exists to derive it from:
// `database-finance.integration.test.ts`.
async function insertDraft(invoiceId: string, suffix: string): Promise<void> {
  await internal(`${prefix}insert-${suffix}`, async (transaction) => {
    const order = await transaction.query.orders.findFirst({
      where: eq(orders.id, orderId),
    });
    const quote = order
      ? await transaction.query.quotes.findFirst({
          where: and(
            eq(quotes.id, order.quoteId),
            eq(quotes.status, "accepted"),
          ),
        })
      : undefined;
    if (!order || !quote) throw new Error("Accepted order fixture is missing");
    insertedInvoiceIds.push(invoiceId);
    await transaction.insert(invoices).values({
      id: invoiceId,
      orderId: order.id,
      accountId: order.invoicingAccountId,
      stripeInvoiceId: null,
      currency: quote.currency,
      amountMinor: quote.totalMinor,
      poNumber: order.poNumber,
      status: "draft",
      dueAt: new Date("2031-02-01T00:00:00.000Z"),
    });
  });
}

async function issueRecord(invoiceId: string, suffix: string) {
  const truth = await internal(
    `${prefix}truth-${suffix}`,
    async (transaction) => {
      const [invoice, order] = await Promise.all([
        transaction.query.invoices.findFirst({
          where: eq(invoices.id, invoiceId),
        }),
        transaction.query.orders.findFirst({ where: eq(orders.id, orderId) }),
      ]);
      if (!invoice || !order) throw new Error("Invoice fixture is missing");
      return { invoice, order };
    },
  );
  const invocationKey = IdempotencyKeySchema.parse(`${prefix}${suffix}`);
  const record = {
    kind: "invoice_issued",
    taskId: "core.billing.issue-invoice.v1",
    input: {
      context: {
        aggregateId: invoiceId,
        aggregateVersion: truth.invoice.rowVersion,
        requestId: `${prefix}context-${suffix}`,
        occurredAt: "2031-01-01T00:01:00.000Z",
      },
      invoiceId,
      orderId,
      billingAccountId: accountId,
      customerId: `cus_demo_${accountId.replaceAll("-", "")}`,
      commercialShape: truth.order.sourcing,
      collectionMethod: "net_terms",
      amount: {
        currency: truth.invoice.currency,
        minor: truth.invoice.amountMinor.toString(),
      },
      ...(truth.invoice.poNumber ? { poNumber: truth.invoice.poNumber } : {}),
      apEmail: "ap@northstar.example",
      vendorSetupComplete: true,
      groups: [],
    },
    providerInvoiceId: `in_${suffix}`,
    providerStatus: "open",
    accountingPostingId: `qbo_post_${suffix}`,
  } as const;
  const input = {
    invocationKey,
    aggregateId: invoiceId,
    aggregateVersion: truth.invoice.rowVersion,
    requestId: `${prefix}issue-${suffix}`,
    occurredAt: "2031-01-01T00:01:00.000Z",
    record,
  };
  return { input, record, truth };
}

// Cases own independent invoice IDs and only read the shared accepted order.
describe.concurrent("invoice-workflow projection", () => {
  it("atomically binds provider and accounting IDs with invoice audit/outbox", async () => {
    const invoiceId = randomUUID();
    const suffix = randomUUID();
    await insertDraft(invoiceId, suffix);
    const issued = await issueRecord(invoiceId, suffix);
    await expect(records.record(issued.input)).resolves.toEqual({});
    await expect(records.record(issued.input)).resolves.toEqual({
      duplicate: true,
    });

    const persisted = await internal(
      `${prefix}inspect-${suffix}`,
      async (transaction) => {
        const invoice = await transaction.query.invoices.findFirst({
          where: eq(invoices.id, invoiceId),
        });
        const event = await transaction.query.auditEvents.findFirst({
          where: and(
            eq(auditEvents.aggregateId, invoiceId),
            eq(auditEvents.eventType, "workflow.invoice_issued"),
          ),
        });
        const outbox = event
          ? await transaction.query.outboxMessages.findFirst({
              where: eq(outboxMessages.eventId, event.id),
            })
          : undefined;
        return { invoice, event, outbox };
      },
    );
    expect(persisted.invoice).toMatchObject({
      status: "open",
      stripeInvoiceId: issued.record.providerInvoiceId,
      accountingPostingId: issued.record.accountingPostingId,
      rowVersion: 2,
    });
    expect(persisted.event).toMatchObject({
      aggregateType: "invoice",
      aggregateVersion: 2,
      eventType: "workflow.invoice_issued",
    });
    expect(persisted.outbox).toMatchObject({
      topic: "workflow.invoice_issued",
    });

    await expect(
      records.record({
        ...issued.input,
        record: {
          ...issued.record,
          providerInvoiceId: `in_conflict_${suffix}`,
        },
      }),
    ).rejects.toThrow("WORKFLOW_RECORD_PAYLOAD_CONFLICT");
  });

  it("rolls back the workflow claim when caller money differs from local truth", async () => {
    const invoiceId = randomUUID();
    const suffix = randomUUID();
    await insertDraft(invoiceId, suffix);
    const issued = await issueRecord(invoiceId, suffix);
    await expect(
      records.record({
        ...issued.input,
        record: {
          ...issued.record,
          input: {
            ...issued.record.input,
            amount: {
              ...issued.record.input.amount,
              minor: (BigInt(issued.record.input.amount.minor) + 1n).toString(),
            },
          },
        },
      }),
    ).rejects.toThrow("INVOICE_WORKFLOW_PERSISTED_TRUTH_MISMATCH");
    const invoice = await internal(
      `${prefix}rollback-${suffix}`,
      (transaction) =>
        transaction.query.invoices.findFirst({
          where: eq(invoices.id, invoiceId),
        }),
    );
    expect(invoice).toMatchObject({
      status: "draft",
      stripeInvoiceId: null,
      accountingPostingId: null,
      rowVersion: 1,
    });
  });
});
