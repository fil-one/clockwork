import { createHash } from "node:crypto";

import {
  deletionCertificateRequestHash,
  type DeletionCertificateRequest,
} from "@clockwork/db";
import { FakeEvidenceStorageAdapter } from "@clockwork/integrations";
import { describe, expect, it, vi } from "vitest";

import {
  createDeletionCertificateOutboxHandler,
  type DeletionCertificatePersistencePort,
  type DeletionCertificateRenderer,
} from "./deletion-certificate-handler";

const body: Omit<DeletionCertificateRequest, "requestHash"> = {
  requestVersion: 1,
  terminationId: "90000000-0000-4000-8000-000000000001",
  accountId: "10000000-0000-4000-8000-000000000001",
  orderId: "80000000-0000-4000-8000-000000000001",
  organizationId: "30000000-0000-4000-8000-000000000001",
  certificateNumber: "DEL-90000000-0000-4000-8000-000000000001",
  account: {
    legalName: "Northstar Archive Labs",
    address: {
      line1: "1 Fiction Way",
      locality: "Boston",
      region: "MA",
      postalCode: "02108",
      countryCode: "US",
    },
  },
  deletedScope: ["deletable tenant remainder after retained exclusions"],
  deletionMethod: "provider-verified cryptographic erasure",
  completedAt: "2026-07-31T16:00:00.000Z",
  retainedObjectExclusions: [
    {
      objectId: "40000000-0000-4000-8000-000000000001",
      scope: "document:agreement_template",
      retainUntil: "2033-07-31T16:00:00.000Z",
      legalHold: false,
      reason: "object_lock_retention",
    },
  ],
  approvals: [
    {
      approvalId: "a0000000-0000-4000-8000-000000000001",
      approverId: "20000000-0000-4000-8000-000000000005",
      approverName: "Drew Distributor",
      role: "destructive_action_approver",
      approvedAt: "2026-07-31T15:50:00.000Z",
      evidenceHash: "a".repeat(64),
      authenticationEvidenceHash: "b".repeat(64),
    },
    {
      approvalId: "a0000000-0000-4000-8000-000000000002",
      approverId: "20000000-0000-4000-8000-000000000006",
      approverName: "Robin White Label",
      role: "destructive_action_approver",
      approvedAt: "2026-07-31T15:55:00.000Z",
      evidenceHash: "c".repeat(64),
      authenticationEvidenceHash: "d".repeat(64),
    },
  ],
  providerEvidence: {
    commandId: "teardown-command-1",
    commandIdempotencyKey: "teardown:idempotency-command-1",
    confirmationId: "confirmation-1",
    operationId: "operation-1",
    tenantId: "tenant-1",
    confirmedAt: "2026-07-31T16:00:00.000Z",
  },
  retainUntil: "2033-07-31T16:00:00.000Z",
};
const request: DeletionCertificateRequest = {
  ...body,
  requestHash: deletionCertificateRequestHash(body),
};
const renderer: DeletionCertificateRenderer = {
  render(certificateRequest) {
    const bytes = new TextEncoder().encode(JSON.stringify(certificateRequest));
    return Promise.resolve({
      bytes,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      mimeType: "application/pdf",
    });
  },
};
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

function invocation(suffix: string) {
  return {
    messageId: `message-${suffix}`,
    eventId: `event-${suffix}`,
    topic: "termination.deletion_certificate_requested",
    payload: {
      eventType: "termination.deletion_certificate_requested",
      data: { certificateRequest: request },
    },
    idempotencyKey: `outbox:deletion-certificate-${suffix}`,
  };
}

describe("deletion certificate outbox provider contract", () => {
  it("fails closed while automated teardown remains externally gated", () => {
    expect(() =>
      createDeletionCertificateOutboxHandler({
        evidence: new FakeEvidenceStorageAdapter(),
        persistence: { issue: vi.fn() },
        issuer,
        automatedTeardownEnabled: false,
        renderer,
      }),
    ).toThrow("AUTOMATED_TEARDOWN_EXTERNALLY_GATED");
  });

  it("replays storage success after a database crash without mutable bytes", async () => {
    const evidence = new FakeEvidenceStorageAdapter();
    let crashBeforeCommit = true;
    const issue = vi.fn<DeletionCertificatePersistencePort["issue"]>(
      (input) => {
        if (crashBeforeCommit) {
          crashBeforeCommit = false;
          return Promise.reject(new Error("SIMULATED_DATABASE_CRASH"));
        }
        return Promise.resolve({
          certificateId: "99000000-0000-4000-8000-000000000001",
          documentId: input.artifact.documentId,
          duplicate: false,
        });
      },
    );
    const handler = createDeletionCertificateOutboxHandler({
      evidence,
      persistence: { issue },
      issuer,
      automatedTeardownEnabled: true,
      renderer,
    });
    await expect(handler(invocation("first"))).rejects.toThrow(
      "SIMULATED_DATABASE_CRASH",
    );
    await expect(handler(invocation("replay"))).resolves.toBeUndefined();
    expect(issue).toHaveBeenCalledTimes(2);
    const [first, replay] = issue.mock.calls.map(([input]) => input.artifact);
    expect(replay).toEqual(first);
  });
});
