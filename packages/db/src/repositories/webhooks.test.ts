import { describe, expect, it } from "vitest";

import { sanitizeWebhookProcessingError } from "./webhooks";

describe("webhook processing error persistence", () => {
  it("does not persist provider messages containing secrets or PII", () => {
    const unsafe =
      "Authorization: Bearer live-secret; customer jane@example.test failed";
    const sanitized = sanitizeWebhookProcessingError(unsafe);
    expect(sanitized).toBe("WEBHOOK_PROCESSING_FAILED");
    expect(sanitized).not.toContain("live-secret");
    expect(sanitized).not.toContain("jane@example.test");
  });
});
