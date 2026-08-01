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
  }): Promise<
    | { status: "claimed"; claimToken: string }
    | { status: "duplicate" }
    | { status: "in_progress" }
  >;
  markProcessed(
    provider: string,
    eventId: string,
    claimToken: string,
  ): Promise<void>;
  markFailed(
    provider: string,
    eventId: string,
    claimToken: string,
    error: string,
  ): Promise<void>;
}

export async function verifyAndClaimWebhook<T>(input: {
  provider: string;
  eventType(payload: T): string;
  rawBody: Uint8Array;
  signature: string;
  verifier: WebhookVerifier<T>;
  deduplicator: WebhookDeduplicator;
  validatePayload?: (payload: T) => void;
  persistedPayload?: (payload: T) => unknown;
}) {
  const verified = await input.verifier.verify({
    rawBody: input.rawBody,
    signature: input.signature,
  });
  input.validatePayload?.(verified.payload);
  const eventType = input.eventType(verified.payload);
  const payloadHash = createHash("sha256").update(input.rawBody).digest("hex");
  const claim = await input.deduplicator.claim({
    provider: input.provider,
    eventId: verified.eventId,
    eventType,
    payloadHash,
    payload: input.persistedPayload
      ? input.persistedPayload(verified.payload)
      : verified.payload,
    occurredAt: verified.occurredAt,
  });
  return { claim, verified, payloadHash };
}
