import {
  coreScheduleIds,
  DatabaseCoreScheduledDispatchStore,
  type CoreScheduleDispatchRequest,
  type CoreWorkflowTaskDispatch,
  type RuntimeDatabase,
} from "@clockwork/db";
import { z } from "zod";

import type { OutboxTopicHandler } from "../system/outbox-dispatcher";
import type { CoreWorkflowTaskSubmitter } from "./outbox-handlers";
import {
  CertificateExpiryInputSchema,
  DunningInputSchema,
  ExportReportInputSchema,
  PartnerCreditInputSchema,
  ReconcileUsageInputSchema,
  SettleCommissionsInputSchema,
  SyncOverageInputSchema,
  ThreeWayReconciliationInputSchema,
} from "./schemas";
import type { TaxPort } from "@clockwork/contracts";

const ScheduleEnvelopeSchema = z
  .object({
    eventType: z.literal("core.schedule.dispatch_requested"),
    aggregateType: z.literal("workflow_run"),
    aggregateId: z.uuid(),
    aggregateVersion: z.literal(1),
    occurredAt: z.iso.datetime({ offset: true }),
    requestId: z.string().min(8).max(128),
    data: z
      .object({
        scheduleId: z.enum(coreScheduleIds),
        scheduledAt: z.iso.datetime({ offset: true }),
      })
      .strict(),
  })
  .passthrough();

export interface CoreScheduledDispatchStore {
  buildDueDispatches(
    input: CoreScheduleDispatchRequest,
  ): Promise<readonly CoreWorkflowTaskDispatch[]>;
}

const taskSchemas = {
  "core.billing.sync-overage.v1": SyncOverageInputSchema,
  "core.collections.dunning.v1": DunningInputSchema,
  "core.collections.partner-credit.v1": PartnerCreditInputSchema,
  "core.commissions.settle.v1": SettleCommissionsInputSchema,
  "core.procurement.certificate-expiry.v1": CertificateExpiryInputSchema,
  "core.reconciliation.usage.v1": ReconcileUsageInputSchema,
  "core.reconciliation.three-way.v1": ThreeWayReconciliationInputSchema,
  "core.reporting.export.v1": ExportReportInputSchema,
} as const;

function scheduledHandler(input: {
  store: CoreScheduledDispatchStore;
  submitter: CoreWorkflowTaskSubmitter;
}): OutboxTopicHandler {
  return async (delivery) => {
    const event = ScheduleEnvelopeSchema.parse(delivery.payload);
    if (event.data.scheduledAt !== event.occurredAt)
      throw new Error("CORE_SCHEDULE_EVENT_TIME_MISMATCH");
    const dispatches = await input.store.buildDueDispatches({
      scheduleId: event.data.scheduleId,
      occurrenceId: event.aggregateId,
      scheduledAt: event.data.scheduledAt,
      requestId: delivery.messageId,
      idempotencyPrefix: delivery.idempotencyKey,
    });
    for (const dispatch of dispatches) {
      if (dispatch.taskId === "core.billing.issue-invoice.v1")
        throw new Error("CORE_SCHEDULE_TASK_NOT_SCHEDULED");
      const schema = taskSchemas[dispatch.taskId];
      const payload = schema.parse(dispatch.payload);
      await input.submitter.submit({
        taskId: dispatch.taskId,
        payload,
        idempotencyKey: dispatch.idempotencyKey,
      });
    }
  };
}

export function createCoreScheduledOutboxHandler(input: {
  db: RuntimeDatabase;
  authorizationSecret: string;
  tax: TaxPort;
  submit: CoreWorkflowTaskSubmitter;
}): OutboxTopicHandler {
  return scheduledHandler({
    store: new DatabaseCoreScheduledDispatchStore(
      input.db,
      input.authorizationSecret,
      input.tax,
    ),
    submitter: input.submit,
  });
}

export function createCoreScheduledOutboxHandlerWithStore(input: {
  store: CoreScheduledDispatchStore;
  submit: CoreWorkflowTaskSubmitter;
}): OutboxTopicHandler {
  return scheduledHandler({ store: input.store, submitter: input.submit });
}
