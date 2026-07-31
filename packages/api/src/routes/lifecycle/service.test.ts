import { describe, expect, it, vi } from "vitest";

import type { LifecycleOperationContext } from ".";
import { TransactionalLifecycleService } from "./service";

const context: LifecycleOperationContext = {
  requestId: "request-0001",
  actor: { kind: "user", id: "user-1" },
  idempotencyKey: "lifecycle-service-0001",
  ip: "192.0.2.1",
  userAgent: "test",
  occurredAt: "2026-07-31T16:00:00.000Z",
  authorization: null,
};

describe("transactional lifecycle application service", () => {
  it("rejects caller-supplied contracted value and POC success assertions", () => {
    const service = new TransactionalLifecycleService({
      executeInTransaction: vi.fn(),
    });
    expect(() =>
      service.executeClickThrough(
        { cumulativeAccountValueMinor: "1", templateId: "template-1" },
        context,
      ),
    ).toThrow("CONTRACT_VALUE_MUST_BE_SERVER_DERIVED");
    expect(() =>
      service.convertPoc({ allSuccessTestsPassed: true }, context),
    ).toThrow("POC_CONVERSION_STATE_MUST_BE_SERVER_DERIVED");
  });

  it("requires trusted registration evidence and forwards it transactionally", async () => {
    const executeInTransaction = vi.fn().mockResolvedValue({
      id: "account-1",
      status: "screening_pending",
    });
    const service = new TransactionalLifecycleService({ executeInTransaction });
    expect(() =>
      service.register({ legalName: "Unverified" }, context),
    ).toThrow("TRUSTED_REGISTRATION_EVIDENCE_REQUIRED");
    await service.register(
      {
        legalName: "Verified Ltd",
        workosUserId: "workos-user-1",
        domainVerifiedAt: "2026-07-31T16:00:00.000Z",
      },
      context,
    );
    expect(executeInTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ command: "register" }),
    );
  });

  it("requires provider actors for webhook transactions", () => {
    const service = new TransactionalLifecycleService({
      executeInTransaction: vi.fn(),
    });
    expect(() => service.ingestSignatureEvent({}, context)).toThrow(
      "PROVIDER_ACTOR_REQUIRED",
    );
  });
});
