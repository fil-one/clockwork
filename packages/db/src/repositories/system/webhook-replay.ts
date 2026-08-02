import { and, desc, eq, isNotNull, isNull, or } from "drizzle-orm";
import { z } from "zod";

import type { RuntimeDatabase } from "../../client";
import { webhookEvents } from "../../schema";
import { withInternalTransaction } from "../../transaction";

/**
 * Verified provider callbacks an operator may replay.
 *
 * A replay re-processes the stored, signature-verified bytes. Nothing here
 * exposes those bytes: the payload, the signature header, and the lock token
 * stay in the row. The runbook forbids putting a webhook secret or payload into
 * a ticket or a log, and an operator surface is a place both of those end up.
 */
export interface ReplayableWebhookEvent {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  /** Content hash of the verified bytes. Replay identity, with the event id. */
  payloadHash: string;
  occurredAt: string;
  signatureVerifiedAt: string;
  attemptCount: number;
  processedAt: string | null;
  /** Operator-safe failure text as the consumer recorded it. */
  processingError: string | null;
  state: "failed" | "unprocessed" | "processed";
}

const ListInputSchema = z
  .object({
    provider: z.string().trim().min(1).max(120).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    requestId: z.string().min(8).max(255),
  })
  .strict();

export type WebhookReplayListInput = z.input<typeof ListInputSchema>;

function instant(value: Date): string {
  return value.toISOString();
}

function state(row: {
  processedAt: Date | null;
  processingError: string | null;
}): ReplayableWebhookEvent["state"] {
  if (row.processingError) return "failed";
  return row.processedAt ? "processed" : "unprocessed";
}

/**
 * Reads the replay candidates for the operator surface.
 *
 * A processed callback with no error is deliberately absent: replaying one is
 * legitimate but rare, and listing every settled event would bury the ones that
 * actually stopped. Look one up by provider and event id instead.
 */
export class DatabaseWebhookReplayReadModel {
  public constructor(private readonly database: RuntimeDatabase) {}

  public async list(
    input: WebhookReplayListInput,
  ): Promise<readonly ReplayableWebhookEvent[]> {
    const parsed = ListInputSchema.parse(input);
    const rows = await withInternalTransaction(
      this.database,
      parsed.requestId,
      (transaction) =>
        transaction.query.webhookEvents.findMany({
          where: and(
            ...(parsed.provider
              ? [eq(webhookEvents.provider, parsed.provider)]
              : []),
            or(
              isNotNull(webhookEvents.processingError),
              // An unprocessed callback is stopped work, not work in flight.
              isNull(webhookEvents.processedAt),
            ),
          ),
          orderBy: [desc(webhookEvents.occurredAt), desc(webhookEvents.id)],
          limit: parsed.limit,
        }),
    );
    return rows.map((row) => this.present(row));
  }

  private present(
    row: typeof webhookEvents.$inferSelect,
  ): ReplayableWebhookEvent {
    return {
      id: row.id,
      provider: row.provider,
      providerEventId: row.providerEventId,
      eventType: row.eventType,
      payloadHash: row.payloadHash,
      occurredAt: instant(row.occurredAt),
      signatureVerifiedAt: instant(row.signatureVerifiedAt),
      attemptCount: row.attemptCount,
      processedAt: row.processedAt ? instant(row.processedAt) : null,
      processingError: row.processingError,
      state: state(row),
    };
  }
}
