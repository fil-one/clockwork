import { createHash } from "node:crypto";

import type { WebhookVerifier } from "@clockwork/contracts";

export interface WebhookDeduplicator {
  claim(input: {
    provider: string;
    eventId: string;
    eventType: string;
    payloadHash: string;
    payload: unknown;
    occurredAt: string;
  }): Promise<"claimed" | "duplicate" | "in_progress">;
  markProcessed(provider: string, eventId: string): Promise<void>;
  markFailed(provider: string, eventId: string, error: string): Promise<void>;
}

export async function verifyAndClaimWebhook<T>(input: {
  provider: string;
  eventType: string;
  rawBody: Uint8Array;
  signature: string;
  verifier: WebhookVerifier<T>;
  deduplicator: WebhookDeduplicator;
}) {
  const verified = await input.verifier.verify({
    rawBody: input.rawBody,
    signature: input.signature,
  });
  const payloadHash = createHash("sha256").update(input.rawBody).digest("hex");
  const claim = await input.deduplicator.claim({
    provider: input.provider,
    eventId: verified.eventId,
    eventType: input.eventType,
    payloadHash,
    payload: verified.payload,
    occurredAt: verified.occurredAt,
  });
  return { claim, verified, payloadHash };
}
