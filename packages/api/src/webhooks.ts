import { createHash } from "node:crypto";

import { ProblemError } from "@clockwork/contracts";
import type { DenialCode, WebhookVerifier } from "@clockwork/contracts";

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

/**
 * Signature failure is a denial, not an internal fault. The typed code is what
 * runtime alerting matches on, so verification failures must not reach the
 * generic error path.
 */
export class WebhookSignatureError extends Error {
  public readonly code: DenialCode = "WEBHOOK_SIGNATURE_INVALID";

  public constructor(
    public readonly provider: string,
    options?: { cause?: unknown },
  ) {
    super("Webhook signature verification failed", options);
    this.name = "WebhookSignatureError";
  }
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
  let verified;
  try {
    verified = await input.verifier.verify({
      rawBody: input.rawBody,
      signature: input.signature,
    });
  } catch (cause) {
    // A verifier that fails its activation gate reports its own problem; only
    // an unclassified rejection is a signature failure.
    if (cause instanceof ProblemError) throw cause;
    throw new WebhookSignatureError(input.provider, { cause });
  }
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
