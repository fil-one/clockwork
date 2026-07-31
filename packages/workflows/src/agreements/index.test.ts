import { describe, expect, it } from "vitest";

import {
  ingestVerifiedSignatureEvent,
  planSignatureReminder,
  routeNegotiatedAgreement,
  startCounterSignature,
} from "./index";

describe("agreement workflows", () => {
  it("starts an envelope with redirect fallback and a durable wait", () => {
    const started = startCounterSignature({
      agreementId: "agreement-1",
      accountId: "account-1",
      documentId: "document-1",
      signerEmail: "buyer@example.test",
      version: 1,
      expiresAt: "2026-08-31T00:00:00.000Z",
    });
    expect(started.effect.payload).toMatchObject({
      redirectFallbackRequired: true,
    });
    expect(started.wait.resumeEvents).toContain("signature.completed");
  });

  it("ingests signed PDF and certificate with unique stable keys", () => {
    const input = {
      agreementId: "agreement-1",
      accountId: "account-1",
      version: 2,
      currentState: "sent" as const,
      processedProviderEventIds: new Set<string>(),
      retainUntil: "2033-07-31T00:00:00.000Z",
      event: {
        providerEventId: "evt-1",
        envelopeId: "env-1",
        occurredAt: "2026-07-31T16:00:00.000Z",
        state: "completed" as const,
        signedPdf: new Uint8Array([1]),
        certificate: new Uint8Array([2]),
        signedPdfSha256: "a".repeat(64),
        certificateSha256: "b".repeat(64),
      },
    };
    const result = ingestVerifiedSignatureEvent(input);
    expect(result.status).toBe("completed");
    expect(result.effects.map((effect) => effect.kind)).toEqual([
      "store_signed_pdf",
      "store_completion_certificate",
      "record_envelope_state",
    ]);
    expect(
      new Set(result.effects.map((effect) => effect.idempotencyKey)).size,
    ).toBe(3);
    expect(
      ingestVerifiedSignatureEvent({
        ...input,
        processedProviderEventIds: new Set(["evt-1"]),
      }).status,
    ).toBe("replay_ignored");
    expect(
      ingestVerifiedSignatureEvent({
        ...input,
        currentState: "completed",
        event: { ...input.event, providerEventId: "evt-old", state: "viewed" },
      }).status,
    ).toBe("out_of_order_ignored");
  });

  it("requires evidence for completed envelopes and routes customer paper", () => {
    expect(() =>
      ingestVerifiedSignatureEvent({
        agreementId: "agreement-1",
        accountId: "account-1",
        version: 1,
        currentState: "sent",
        processedProviderEventIds: new Set(),
        retainUntil: "2033-01-01T00:00:00.000Z",
        event: {
          providerEventId: "evt-1",
          envelopeId: "env-1",
          occurredAt: "2026-01-01T00:00:00.000Z",
          state: "completed",
        },
      }),
    ).toThrow("COMPLETED_ENVELOPE_EVIDENCE_REQUIRED");
    expect(
      routeNegotiatedAgreement({
        agreementId: "agreement-1",
        version: 1,
        paper: "theirs",
        hasRedlines: false,
        keyTermsComplete: true,
      }),
    ).toHaveLength(1);
  });

  it("does not remind terminal envelopes", () => {
    expect(
      planSignatureReminder({
        agreementId: "agreement-1",
        version: 1,
        envelopeId: "env-1",
        state: "completed",
        reminderNumber: 1,
        executeAt: "2026-08-01T00:00:00.000Z",
      }),
    ).toBeNull();
  });
});
