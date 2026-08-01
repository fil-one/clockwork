import {
  DatabasePersistedStripeAdjustmentStore,
  type RuntimeDatabase,
} from "@clockwork/db";
import {
  PersistedStripeAdjustmentSubmitter,
  type StripeCommercialGateway,
} from "@clockwork/integrations/core";
import { z } from "zod";

import type { OutboxTopicHandler } from "../system/outbox-dispatcher";

const AdjustmentEventSchema = z
  .object({
    eventType: z.enum(["core.credit_notes.issue", "core.refunds.submit"]),
    aggregateType: z.enum(["credit_note", "refund"]),
    aggregateId: z.uuid(),
    aggregateVersion: z.int().positive(),
  })
  .passthrough()
  .superRefine((event, context) => {
    if (
      (event.eventType === "core.credit_notes.issue" &&
        event.aggregateType !== "credit_note") ||
      (event.eventType === "core.refunds.submit" &&
        event.aggregateType !== "refund")
    )
      context.addIssue({
        code: "custom",
        path: ["aggregateType"],
        message: "Stripe adjustment event binding is invalid",
      });
  });

export function createStripeAdjustmentOutboxHandlers(input: {
  db: RuntimeDatabase;
  stripe: Pick<StripeCommercialGateway, "issueCreditNote" | "refundPayment">;
}): ReadonlyMap<string, OutboxTopicHandler> {
  const submitter = new PersistedStripeAdjustmentSubmitter(
    new DatabasePersistedStripeAdjustmentStore(input.db),
    input.stripe,
  );
  return createStripeAdjustmentOutboxHandlersWithSubmitter({ submitter });
}

export function createStripeAdjustmentOutboxHandlersWithSubmitter(input: {
  submitter: Pick<PersistedStripeAdjustmentSubmitter, "submit">;
}): ReadonlyMap<string, OutboxTopicHandler> {
  const handler: OutboxTopicHandler = async (delivery) => {
    const event = AdjustmentEventSchema.parse(delivery.payload);
    const result = await input.submitter.submit({
      adjustmentId: event.aggregateId,
      expectedVersion: event.aggregateVersion,
    });
    if (!result.ok) {
      if (result.kind === "transient") throw new Error(result.code);
      throw new Error(`STRIPE_ADJUSTMENT_REJECTED:${result.code}`);
    }
    if (result.value.status === "in_progress")
      throw new Error("STRIPE_ADJUSTMENT_IN_PROGRESS");
  };
  return new Map([
    ["core.credit_notes.issue", handler],
    ["core.refunds.submit", handler],
  ]);
}
