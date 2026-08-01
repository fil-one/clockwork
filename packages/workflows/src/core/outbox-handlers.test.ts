import { describe, expect, it, vi } from "vitest";

import type { CoreWorkflowTaskDispatch } from "@clockwork/db";

import { coreWorkflowTaskIds } from "./ports";
import {
  coreWorkflowDispatchPlan,
  createCoreWorkflowOutboxHandlersWithStore,
  type CoreWorkflowDispatchStore,
} from "./outbox-handlers";

const invoiceId = "10000000-0000-4000-8000-000000000001";
const orderId = "20000000-0000-4000-8000-000000000001";
const paymentId = "30000000-0000-4000-8000-000000000001";
const statementId = "40000000-0000-4000-8000-000000000001";

function event(input: {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
}) {
  return {
    eventId: "50000000-0000-4000-8000-000000000001",
    ...input,
    aggregateVersion: 3,
    occurredAt: "2026-07-31T16:00:00.000Z",
    requestId: "request-core-outbox-0001",
    actor: { kind: "system", id: "test" },
    data: {
      // Deliberately hostile values: production builders ignore this data.
      amountMinor: "999999999999",
      customerId: "caller-controlled",
      partnerAccountId: "caller-controlled",
    },
  };
}

function delivery(payload: unknown, topic: string) {
  return {
    messageId: "60000000-0000-4000-8000-000000000001",
    eventId: "50000000-0000-4000-8000-000000000001",
    topic,
    payload,
    idempotencyKey: "outbox:60000000-0000-4000-8000-000000000001",
  };
}

function issueDispatch(idempotencyKey: string): CoreWorkflowTaskDispatch {
  return {
    taskId: "core.billing.issue-invoice.v1",
    idempotencyKey,
    payload: {
      context: {
        aggregateId: invoiceId,
        aggregateVersion: 1,
        requestId: "request-core-outbox-0001",
        occurredAt: "2026-07-31T16:00:00.000Z",
      },
      invoiceId,
      orderId,
      billingAccountId: "70000000-0000-4000-8000-000000000001",
      customerId: "cus_persisted",
      commercialShape: "direct",
      collectionMethod: "auto_charge",
      amount: { currency: "USD", minor: "120000" },
      apEmail: "ap@example.com",
      vendorSetupComplete: true,
      groups: [],
    },
  };
}

function settlementDispatch(idempotencyKey: string): CoreWorkflowTaskDispatch {
  return {
    taskId: "core.commissions.settle.v1",
    idempotencyKey,
    payload: {
      context: {
        aggregateId: statementId,
        aggregateVersion: 1,
        requestId: "request-core-outbox-0001",
        occurredAt: "2026-07-31T16:00:00.000Z",
      },
      statementId,
      partnerAccountId: "80000000-0000-4000-8000-000000000001",
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
      currency: "USD",
      accruals: [
        {
          accrualId: "90000000-0000-4000-8000-000000000001",
          invoiceId,
          currency: "USD",
          collectedRevenueMinor: "-120000",
          commissionMinor: "-14400",
          holdbackMinor: "-1440",
          status: "stated",
        },
      ],
    },
  };
}

function fixture() {
  const ensureInvoiceDraftForProvisionedOrder = vi
    .fn()
    .mockResolvedValue({ invoiceId, created: true });
  const buildIssueInvoiceDispatch = vi.fn((input: { idempotencyKey: string }) =>
    Promise.resolve(issueDispatch(input.idempotencyKey)),
  );
  const buildCommissionSettlementDispatch = vi.fn(
    (input: { idempotencyKey: string }) =>
      Promise.resolve(settlementDispatch(input.idempotencyKey)),
  );
  const projectReferralCommission = vi
    .fn()
    .mockResolvedValue({ status: "projected" });
  const store: CoreWorkflowDispatchStore = {
    ensureInvoiceDraftForProvisionedOrder,
    buildIssueInvoiceDispatch,
    buildCommissionSettlementDispatch,
    projectReferralCommission,
  };
  const submit = vi.fn().mockResolvedValue({ runId: "trigger-run-1" });
  return {
    handlers: createCoreWorkflowOutboxHandlersWithStore({
      store,
      submit: { submit },
    }),
    ensureInvoiceDraftForProvisionedOrder,
    buildIssueInvoiceDispatch,
    buildCommissionSettlementDispatch,
    projectReferralCommission,
    submit,
  };
}

describe("authoritative core outbox joins", () => {
  it("maps every core task to at least one automatic event or UTC schedule", () => {
    expect(Object.keys(coreWorkflowDispatchPlan).sort()).toEqual(
      [...coreWorkflowTaskIds].sort(),
    );
    expect(
      Object.values(coreWorkflowDispatchPlan).every(
        (mapping) => mapping.events.length + mapping.schedules.length > 0,
      ),
    ).toBe(true);
  });

  it("turns provisioning confirmation into an authoritative invoice draft join", async () => {
    const test = fixture();
    const payload = event({
      eventType: "order.provisioning_confirmed",
      aggregateType: "order",
      aggregateId: orderId,
    });

    await test.handlers
      .get("order.provisioning_confirmed")
      ?.call(undefined, delivery(payload, "order.provisioning_confirmed"));

    expect(test.ensureInvoiceDraftForProvisionedOrder).toHaveBeenCalledWith({
      orderId,
      requestId: "60000000-0000-4000-8000-000000000001",
      occurredAt: "2026-07-31T16:00:00.000Z",
    });
    expect(test.submit).not.toHaveBeenCalled();
  });

  it("builds invoice issuance from DB truth and reuses the outbox replay key", async () => {
    const test = fixture();
    const payload = event({
      eventType: "core.invoice.draft_ready",
      aggregateType: "invoice",
      aggregateId: invoiceId,
    });
    const handler = test.handlers.get("core.invoice.draft_ready");
    await handler?.(delivery(payload, "core.invoice.draft_ready"));
    await handler?.(delivery(payload, "core.invoice.draft_ready"));

    expect(test.buildIssueInvoiceDispatch).toHaveBeenCalledWith({
      invoiceId,
      context: {
        aggregateId: invoiceId,
        aggregateVersion: 3,
        requestId: "request-core-outbox-0001",
        occurredAt: "2026-07-31T16:00:00.000Z",
      },
      idempotencyKey: "outbox:60000000-0000-4000-8000-000000000001:issue",
    });
    expect(test.submit).toHaveBeenCalledTimes(2);
    expect(test.submit.mock.calls[0]?.[0]).toMatchObject({
      taskId: "core.billing.issue-invoice.v1",
      idempotencyKey: "outbox:60000000-0000-4000-8000-000000000001:issue",
      payload: {
        customerId: "cus_persisted",
        amount: { currency: "USD", minor: "120000" },
      },
    });
    expect(test.submit.mock.calls[1]?.[0]).toEqual(
      test.submit.mock.calls[0]?.[0],
    );
  });

  it("projects only the persisted payment aggregate from shared Stripe topics", async () => {
    const test = fixture();
    const handler = test.handlers.get("provider.stripe.invoice.paid");
    await handler?.(
      delivery(
        event({
          eventType: "provider.stripe.invoice.paid",
          aggregateType: "invoice",
          aggregateId: invoiceId,
        }),
        "provider.stripe.invoice.paid",
      ),
    );
    expect(test.projectReferralCommission).not.toHaveBeenCalled();

    await handler?.(
      delivery(
        event({
          eventType: "provider.stripe.invoice.paid",
          aggregateType: "payment",
          aggregateId: paymentId,
        }),
        "provider.stripe.invoice.paid",
      ),
    );
    expect(test.projectReferralCommission).toHaveBeenCalledWith({
      sourceType: "payment",
      sourceId: paymentId,
      requestId: "60000000-0000-4000-8000-000000000001",
    });
  });

  it("does not accrue refund commission effects from non-terminal refund.created", () => {
    const test = fixture();
    expect(test.handlers.has("provider.stripe.refund.created")).toBe(false);
    expect(test.handlers.has("provider.stripe.refund.updated")).toBe(true);
  });

  it("routes a signed credit-note void to a distinct compensating source", async () => {
    const test = fixture();
    const creditNoteId = "30000000-0000-4000-8000-000000000099";
    const topic = "provider.stripe.credit_note.voided";
    await test.handlers.get(topic)?.(
      delivery(
        event({
          eventType: topic,
          aggregateType: "credit_note",
          aggregateId: creditNoteId,
        }),
        topic,
      ),
    );
    expect(test.projectReferralCommission).toHaveBeenCalledWith({
      sourceType: "credit_note_void",
      sourceId: creditNoteId,
      requestId: "60000000-0000-4000-8000-000000000001",
    });
  });

  it("submits persisted commission statement lines including signed holdback release", async () => {
    const test = fixture();
    const payload = event({
      eventType: "core.commission_statement.generated",
      aggregateType: "report_export",
      aggregateId: statementId,
    });

    await test.handlers.get("core.commission_statement.generated")?.(
      delivery(payload, "core.commission_statement.generated"),
    );

    expect(test.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "core.commissions.settle.v1",
        idempotencyKey: "outbox:60000000-0000-4000-8000-000000000001:settle",
      }),
    );
  });
});
