import { ProblemError } from "@clockwork/contracts";
import type { WebhookVerifier } from "@clockwork/contracts";
import { describe, expect, it, vi } from "vitest";

import { verifyAndClaimWebhook, WebhookSignatureError } from "./webhooks";
import type { WebhookDeduplicator } from "./webhooks";

const claim = vi.fn<WebhookDeduplicator["claim"]>();
const deduplicator: WebhookDeduplicator = {
  claim,
  markProcessed: vi.fn(),
  markFailed: vi.fn(),
};

function claimWith(verifier: WebhookVerifier<unknown>) {
  return verifyAndClaimWebhook({
    provider: "stripe",
    eventType: () => "invoice.paid",
    rawBody: new TextEncoder().encode("{}"),
    signature: "signature",
    verifier,
    deduplicator,
  });
}

describe("verifyAndClaimWebhook", () => {
  it("types an unclassified verification rejection as a signature denial", async () => {
    const cause = new Error("timestamp outside tolerance");
    const error: unknown = await claimWith({
      verify: vi.fn().mockRejectedValue(cause),
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(WebhookSignatureError);
    expect(error).toMatchObject({
      code: "WEBHOOK_SIGNATURE_INVALID",
      provider: "stripe",
      cause,
    });
    expect(claim).not.toHaveBeenCalled();
  });

  it("leaves a verifier's own problem unchanged", async () => {
    const problem = new ProblemError({
      type: "https://clockwork.test/problems/external-gate-inactive",
      title: "External provider activation gate is not active",
      status: 503,
      code: "EXTERNAL_GATE_INACTIVE",
      requestId: "request-webhook-gate",
      retryable: true,
    });

    await expect(
      claimWith({ verify: vi.fn().mockRejectedValue(problem) }),
    ).rejects.toBe(problem);
  });
});
