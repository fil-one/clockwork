import { createHash } from "node:crypto";

import {
  commercialArtifactRequestHash,
  commercialArtifactSourceHash,
  type CommercialArtifactRequest,
} from "@clockwork/db";
import { FakeEvidenceStorageAdapter } from "@clockwork/integrations";
import { describe, expect, it, vi } from "vitest";

import {
  createCommercialArtifactOutboxHandler,
  type CommercialArtifactPersistencePort,
  type CommercialArtifactRenderer,
} from "./commercial-artifact-handler";

const issuer = {
  legalName: "Fil One, Inc.",
  address: {
    line1: "9 Fiction Way",
    locality: "Wilmington",
    region: "DE",
    postalCode: "19801",
    countryCode: "US",
  },
};

const renderer: CommercialArtifactRenderer = {
  render({ request: artifactRequest }) {
    const bytes = new TextEncoder().encode(
      JSON.stringify(artifactRequest.sourceDefinition),
    );
    return Promise.resolve({
      bytes,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      recordHash: artifactRequest.sourceHash,
      documentId: artifactRequest.sourceDefinition.displayDocumentId,
      version: artifactRequest.sourceDefinition.documentVersion,
      mimeType: "application/pdf",
    });
  },
};

function request(): CommercialArtifactRequest {
  const sourceDefinition = {
    kind: "direct_quote" as const,
    displayDocumentId: "Q-90000000-0000-4000-8000-000000000001-R1-end_client",
    documentVersion: "1",
    issuedAt: "2026-07-31T16:00:00.000Z",
    locale: "en-US" as const,
    recipient: {
      legalName: "Northstar Archive LLC",
      address: {
        line1: "1 Archive Way",
        locality: "New York",
        region: "NY",
        postalCode: "10001",
        countryCode: "US",
      },
    },
    issuerMode: "platform" as const,
    quoteNumber: "Q-90000000-0000-4000-8000-000000000001-R1",
    validUntil: "2026-12-31",
    currency: "USD" as const,
    lineItems: [
      {
        id: "line-1",
        description: "Locked storage",
        quantity: "1",
        unitLabel: "TB-month",
        unitPrice: { currency: "USD" as const, minorUnits: "10000" },
        amount: { currency: "USD" as const, minorUnits: "10000" },
      },
    ],
    totals: {
      subtotal: { currency: "USD" as const, minorUnits: "10000" },
      total: { currency: "USD" as const, minorUnits: "10000" },
    },
    paymentTerms: "Net 30 days",
  };
  const sourceHash = commercialArtifactSourceHash(sourceDefinition);
  const body: Omit<CommercialArtifactRequest, "requestHash"> = {
    requestVersion: 1,
    requestId: "92000000-0000-4000-8000-000000000001",
    subjectType: "quote",
    subjectId: "90000000-0000-4000-8000-000000000001",
    commercialAccountId: "10000000-0000-4000-8000-000000000001",
    audienceAccountId: "10000000-0000-4000-8000-000000000001",
    audience: "end_client",
    documentKind: "direct_quote",
    sourceHash,
    sourceDefinition,
    retainUntil: "2033-07-31T16:00:00.000Z",
  };
  return { ...body, requestHash: commercialArtifactRequestHash(body) };
}

function invocation(artifactRequest = request()) {
  return {
    messageId: "93000000-0000-4000-8000-000000000001",
    eventId: "94000000-0000-4000-8000-000000000001",
    topic: "commerce.commercial_artifact_requested",
    payload: {
      eventType: "commerce.commercial_artifact_requested",
      data: { artifactRequest },
    },
    idempotencyKey: "outbox:commercial-artifact-test",
  };
}

describe("commercial artifact outbox provider contract", () => {
  it("replays immutable storage after a database crash with identical bytes", async () => {
    const evidence = new FakeEvidenceStorageAdapter();
    let crashBeforeCommit = true;
    const issue = vi.fn<CommercialArtifactPersistencePort["issue"]>((input) => {
      if (crashBeforeCommit) {
        crashBeforeCommit = false;
        return Promise.reject(new Error("SIMULATED_DATABASE_CRASH"));
      }
      return Promise.resolve({
        documentId: input.artifact.documentId,
        duplicate: false,
      });
    });
    const handler = createCommercialArtifactOutboxHandler({
      evidence,
      persistence: { issue },
      platformIssuer: issuer,
      renderer,
    });
    await expect(handler(invocation())).rejects.toThrow(
      "SIMULATED_DATABASE_CRASH",
    );
    await handler({
      ...invocation(),
      idempotencyKey: "outbox:commercial-artifact-test:replay",
    });
    expect(issue).toHaveBeenCalledTimes(2);
    expect(issue.mock.calls[0]?.[0].artifact).toEqual(
      issue.mock.calls[1]?.[0].artifact,
    );
  });

  it("rejects a request whose source definition no longer matches its hash", async () => {
    const artifactRequest = request();
    if (artifactRequest.sourceDefinition.kind !== "direct_quote")
      throw new Error("Expected direct quote fixture");
    const tampered: CommercialArtifactRequest = {
      ...artifactRequest,
      sourceDefinition: {
        ...artifactRequest.sourceDefinition,
        paymentTerms: "Secret replacement terms",
      },
    };
    const handler = createCommercialArtifactOutboxHandler({
      evidence: new FakeEvidenceStorageAdapter(),
      persistence: { issue: vi.fn() },
      platformIssuer: issuer,
      renderer,
    });
    await expect(handler(invocation(tampered))).rejects.toThrow(
      "COMMERCIAL_ARTIFACT_SOURCE_HASH_MISMATCH",
    );
  });
});
