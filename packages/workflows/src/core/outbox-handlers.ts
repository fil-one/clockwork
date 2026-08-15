import type {
  CoreWorkflowDispatchContext,
  CoreWorkflowTaskDispatch,
  PersistedCommissionSourceType,
  RuntimeDatabase,
} from "@clockwork/db";
import { DatabaseCoreWorkflowDispatchStore } from "@clockwork/db";
import { z } from "zod";

import type { OutboxTopicHandler } from "../system/outbox-dispatcher";
import type { CoreWorkflowTaskId } from "./ports";
import {
  IssueInvoiceInputSchema,
  SettleCommissionsInputSchema,
} from "./schemas";
import type { TaxPort } from "@clockwork/contracts";

const EventEnvelopeSchema = z
  .object({
    eventType: z.string().min(1),
    aggregateType: z.string().min(1),
    aggregateId: z.uuid(),
    aggregateVersion: z.number().int().positive(),
    occurredAt: z.iso.datetime({ offset: true }),
    requestId: z.string().min(8).max(128),
    data: z.record(z.string(), z.unknown()),
  })
  .passthrough();

const provisioningTopic = "order.provisioning_confirmed";
const invoiceDraftTopics = [
  "core.invoice.draft_ready",
  "core.invoices.create",
] as const;
const commissionTopics = {
  "provider.stripe.payment_intent.succeeded": "payment",
  "provider.stripe.invoice_payment.paid": "payment",
  "provider.stripe.invoice.paid": "payment",
  "provider.stripe.invoice.payment_succeeded": "payment",
  "provider.stripe.credit_note.created": "credit_note",
  "provider.stripe.credit_note.updated": "credit_note",
  "provider.stripe.credit_note.voided": "credit_note_void",
  // refund.created is provider acceptance, not terminal refund truth. Stripe
  // status projection and commission clawback begin only from signed updates.
  "provider.stripe.refund.updated": "refund",
  "provider.stripe.charge.dispute.created": "chargeback",
  "provider.stripe.charge.dispute.updated": "chargeback",
  "provider.stripe.charge.dispute.closed": "chargeback",
} as const satisfies Readonly<Record<string, PersistedCommissionSourceType>>;
const commissionStatementTopic = "core.commission_statement.generated";

export const coreWorkflowDispatchPlan = {
  "core.billing.issue-invoice.v1": {
    events: invoiceDraftTopics,
    schedules: [],
  },
  "core.billing.sync-overage.v1": {
    events: ["core.commitment.period_closed"],
    schedules: ["15 * * * *"],
  },
  "core.collections.dunning.v1": {
    events: ["provider.stripe.invoice.payment_failed"],
    schedules: ["0 7 * * *"],
  },
  "core.collections.partner-credit.v1": {
    events: ["core.orders.create"],
    schedules: ["0 6 * * *"],
  },
  "core.commissions.settle.v1": {
    events: [commissionStatementTopic],
    schedules: ["0 6 1 */3 *"],
  },
  // Certificate expiry is time-driven only. No commerce event marks the day a
  // certificate lapses, which is why onboarding's one-time check never fires
  // again and the sweep has to run on the clock.
  "core.procurement.certificate-expiry.v1": {
    events: [],
    schedules: ["0 4 * * *"],
  },
  "core.reconciliation.usage.v1": {
    events: ["provider.usage.period_closed"],
    schedules: ["30 2 * * *"],
  },
  "core.reconciliation.three-way.v1": {
    events: ["provider.accounting.period_closed"],
    schedules: ["0 5 1 * *"],
  },
  "core.reporting.export.v1": {
    events: ["core.reports.create"],
    schedules: ["0 8 * * 1", "0 8 1 * *"],
  },
} as const satisfies Record<
  CoreWorkflowTaskId,
  { events: readonly string[]; schedules: readonly string[] }
>;

export interface CoreWorkflowTaskSubmitter {
  submit(input: {
    taskId: CoreWorkflowTaskId;
    payload: unknown;
    idempotencyKey: string;
  }): Promise<unknown>;
}

export interface CoreWorkflowDispatchStore {
  ensureInvoiceDraftForProvisionedOrder(input: {
    orderId: string;
    requestId: string;
    occurredAt: string;
  }): Promise<{ invoiceId: string; created: boolean }>;
  buildIssueInvoiceDispatch(input: {
    invoiceId: string;
    context: CoreWorkflowDispatchContext;
    idempotencyKey: string;
  }): Promise<CoreWorkflowTaskDispatch>;
  buildCommissionSettlementDispatch(input: {
    statementId: string;
    context: CoreWorkflowDispatchContext;
    idempotencyKey: string;
  }): Promise<CoreWorkflowTaskDispatch>;
  projectReferralCommission(input: {
    sourceType: PersistedCommissionSourceType;
    sourceId: string;
    requestId: string;
  }): Promise<unknown>;
}

function context(
  event: z.output<typeof EventEnvelopeSchema>,
): CoreWorkflowDispatchContext {
  return {
    aggregateId: event.aggregateId,
    aggregateVersion: event.aggregateVersion,
    requestId: event.requestId,
    occurredAt: event.occurredAt,
  };
}

async function submit(
  dispatcher: CoreWorkflowTaskSubmitter,
  dispatch: CoreWorkflowTaskDispatch,
): Promise<void> {
  const payload =
    dispatch.taskId === "core.billing.issue-invoice.v1"
      ? IssueInvoiceInputSchema.parse(dispatch.payload)
      : SettleCommissionsInputSchema.parse(dispatch.payload);
  await dispatcher.submit({
    taskId: dispatch.taskId,
    payload,
    idempotencyKey: dispatch.idempotencyKey,
  });
}

function handlers(input: {
  store: CoreWorkflowDispatchStore;
  submitter: CoreWorkflowTaskSubmitter;
}): ReadonlyMap<string, OutboxTopicHandler> {
  const result = new Map<string, OutboxTopicHandler>();
  result.set(provisioningTopic, async (delivery) => {
    const event = EventEnvelopeSchema.parse(delivery.payload);
    if (
      event.eventType !== provisioningTopic ||
      event.aggregateType !== "order" ||
      event.aggregateId.length === 0
    )
      throw new Error("PROVISIONING_BILLING_EVENT_BINDING_INVALID");
    await input.store.ensureInvoiceDraftForProvisionedOrder({
      orderId: event.aggregateId,
      requestId: delivery.messageId,
      occurredAt: event.occurredAt,
    });
  });
  for (const topic of invoiceDraftTopics) {
    result.set(topic, async (delivery) => {
      const event = EventEnvelopeSchema.parse(delivery.payload);
      if (event.eventType !== topic || event.aggregateType !== "invoice")
        throw new Error("INVOICE_DRAFT_EVENT_BINDING_INVALID");
      const dispatch = await input.store.buildIssueInvoiceDispatch({
        invoiceId: event.aggregateId,
        context: context(event),
        idempotencyKey: `${delivery.idempotencyKey}:issue`,
      });
      await submit(input.submitter, dispatch);
    });
  }
  for (const [topic, sourceType] of Object.entries(commissionTopics)) {
    result.set(topic, async (delivery) => {
      const event = EventEnvelopeSchema.parse(delivery.payload);
      const aggregateTypes = {
        payment: "payment",
        credit_note: "credit_note",
        credit_note_void: "credit_note",
        refund: "refund",
        chargeback: "dispute_case",
      } as const;
      // Stripe invoice projections intentionally share several event topics.
      // Only the source-specific projection drives a commission join.
      if (event.aggregateType === "invoice") return;
      if (
        event.eventType !== topic ||
        event.aggregateType !== aggregateTypes[sourceType]
      )
        throw new Error("COMMISSION_SOURCE_EVENT_BINDING_INVALID");
      await input.store.projectReferralCommission({
        sourceType,
        sourceId: event.aggregateId,
        requestId: delivery.messageId,
      });
    });
  }
  result.set(commissionStatementTopic, async (delivery) => {
    const event = EventEnvelopeSchema.parse(delivery.payload);
    if (
      event.eventType !== commissionStatementTopic ||
      event.aggregateType !== "report_export"
    )
      throw new Error("COMMISSION_STATEMENT_EVENT_BINDING_INVALID");
    const dispatch = await input.store.buildCommissionSettlementDispatch({
      statementId: event.aggregateId,
      context: context(event),
      idempotencyKey: `${delivery.idempotencyKey}:settle`,
    });
    await submit(input.submitter, dispatch);
  });
  return result;
}

export function createCoreWorkflowOutboxHandlers(input: {
  db: RuntimeDatabase;
  authorizationSecret: string;
  tax: TaxPort;
  submit: CoreWorkflowTaskSubmitter;
}): ReadonlyMap<string, OutboxTopicHandler> {
  return handlers({
    store: new DatabaseCoreWorkflowDispatchStore(
      input.db,
      input.authorizationSecret,
      input.tax,
    ),
    submitter: input.submit,
  });
}

/** Test seam that retains the exact production routing and payload validation. */
export function createCoreWorkflowOutboxHandlersWithStore(input: {
  store: CoreWorkflowDispatchStore;
  submit: CoreWorkflowTaskSubmitter;
}): ReadonlyMap<string, OutboxTopicHandler> {
  return handlers({ store: input.store, submitter: input.submit });
}
