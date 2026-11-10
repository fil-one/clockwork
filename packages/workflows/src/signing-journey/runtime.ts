import { z } from "zod";
import type { RuntimeDatabase } from "@clockwork/db";
import type { OutboxTopicHandler } from "../system/outbox-dispatcher";
import { environmentSigningJourney } from "./environment";

const payloadSchema = z.object({
  aggregateId: z.uuid(),
  occurredAt: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
});
const statuses = [
  "sent",
  "viewed",
  "awaiting_countersignature",
  "completed",
  "declined",
  "expired",
  "canceled",
  "attention",
];
const actions = [
  "reminded",
  "voided",
  "signer_corrected",
  "signer_correction_dropped",
  "signer_correction_requested",
  "signer_correction_refused",
  "deleted_in_signwell",
  "signwell_mismatch",
];
let retry: (() => Promise<unknown>) | undefined;

export function withSigningJourneyHandlers(
  existing: ReadonlyMap<string, OutboxTopicHandler>,
  db: RuntimeDatabase,
  env: Readonly<Record<string, string | undefined>>,
) {
  const journey = environmentSigningJourney(db, env);
  const handlers = new Map(existing);
  retry = journey ? () => journey.service.deliver() : undefined;
  // Access and delivery audit events are evidence, not new work.
  for (const topic of [
    "recipient_opened",
    "recipient_downloaded",
    "access_revoked",
    "recipient_bound",
    "mail_queued",
    "mail_sent",
    "mail_skipped",
    "mail_failed",
    "mail_pending",
  ])
    handlers.set(`signing.${topic}`, async () => {});
  if (!journey) return handlers;
  for (const kind of ["mnda", "contract"] as const) {
    const topics = [
      ...statuses.map(
        (s) => `${kind}.${kind === "contract" ? "signing_" : ""}${s}`,
      ),
      ...actions.map((a) => `${kind}.${a}`),
    ];
    for (const topic of topics) {
      const previous = handlers.get(topic);
      handlers.set(topic, async (delivery) => {
        if (previous) await previous(delivery);
        const payload = payloadSchema.parse(delivery.payload);
        // Old manual reminders must not remind a replacement request. New
        // signing events include the immutable provider ID in their payload.
        if (topic.endsWith(".reminded") && !payload.data.providerId) return;
        await journey.service.synchronize(
          kind,
          payload.aggregateId,
          topic.endsWith(".reminded") ? delivery.eventId : undefined,
          typeof payload.data.providerId === "string"
            ? payload.data.providerId
            : undefined,
        );
        await journey.service.deliver();
      });
    }
  }
  return handlers;
}

export async function retrySigningMail() {
  return retry ? retry() : { skipped: true };
}
