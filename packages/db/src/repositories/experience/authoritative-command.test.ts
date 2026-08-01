import { describe, expect, it, vi } from "vitest";

import type { RuntimeDatabase } from "../../client";
import { DatabaseAuthoritativePortalCommandExecutor } from "./authoritative-command";

const aggregateId = "91000000-0000-4000-8000-000000000003";
const actorId = "20000000-0000-4000-8000-000000000001";
const accountId = "10000000-0000-4000-8000-000000000001";

function executor() {
  return new DatabaseAuthoritativePortalCommandExecutor({
    database: {} as RuntimeDatabase,
    authorizationSecret:
      "release-proof-authorization-secret-000000000000000000000000",
    now: () => new Date("2026-08-01T12:00:00.000Z"),
  });
}

describe("database authoritative portal command executor", () => {
  it("rejects a non-core command binding before touching authoritative state", async () => {
    await expect(
      executor().execute({
        commandResource: "core:orders",
        action: "expire",
        aggregateType: "quote",
        aggregateId,
        expectedVersion: 3,
        payload: {},
        actor: { kind: "user", id: actorId },
        effectiveAccountId: "10000000-0000-4000-8000-000000000001",
        assistedSessionId: null,
        assistedReason: null,
        mfaVerified: true,
        recentAuthenticationVerified: true,
        authorizationCreatedAt: "2026-08-01T12:00:00.000Z",
        idempotencyKey: "portal-action-idempotency-0001",
        requestId: "portal-request-0001",
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "AUTHORITATIVE_COMMAND_BINDING_INVALID",
      authoritativeVersion: null,
      retryable: false,
    });
  });

  it("rejects a non-user actor before touching authoritative state", async () => {
    await expect(
      executor().execute({
        commandResource: "core:quotes",
        action: "expire",
        aggregateType: "quote",
        aggregateId,
        expectedVersion: 3,
        payload: {},
        actor: { kind: "system", id: "portal-worker" },
        effectiveAccountId: "10000000-0000-4000-8000-000000000001",
        assistedSessionId: null,
        assistedReason: null,
        mfaVerified: true,
        recentAuthenticationVerified: true,
        authorizationCreatedAt: "2026-08-01T12:00:00.000Z",
        idempotencyKey: "portal-action-idempotency-0002",
        requestId: "portal-request-0002",
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "AUTHORITATIVE_COMMAND_INVALID",
      authoritativeVersion: null,
      retryable: false,
    });
  });

  it("re-applies the authoritative resource permission after loading current membership", async () => {
    const command = executor();
    const mutateWithReplay = vi.fn();
    const inspectPriorCommand = vi.fn().mockResolvedValue({ kind: "none" });
    Object.assign(command, {
      states: {
        loadVersion: vi.fn().mockResolvedValue({
          aggregateType: "quote",
          aggregateId,
          accountId,
          version: 3,
        }),
      },
      currentAuthorization: vi.fn().mockResolvedValue({
        userId: actorId,
        accountIds: [accountId],
        roles: ["member"],
        isInternalStaff: false,
        mfaVerified: true,
        recentAuthenticationVerified: true,
      }),
      inspectPriorCommand,
      core: { mutateWithReplay },
    });

    await expect(
      command.execute({
        commandResource: "core:quotes",
        action: "expire",
        aggregateType: "quote",
        aggregateId,
        expectedVersion: 3,
        payload: {},
        actor: { kind: "user", id: actorId },
        effectiveAccountId: accountId,
        assistedSessionId: null,
        assistedReason: null,
        mfaVerified: true,
        recentAuthenticationVerified: true,
        authorizationCreatedAt: "2026-08-01T12:00:00.000Z",
        idempotencyKey: "portal-action-idempotency-0003",
        requestId: "portal-request-0003",
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "AUTHORITATIVE_PERMISSION_REVOKED",
      authoritativeVersion: 3,
      retryable: false,
    });
    expect(inspectPriorCommand).toHaveBeenCalledOnce();
    expect(mutateWithReplay).not.toHaveBeenCalled();
  });

  it("recovers an exact committed result before stale authorization or version checks", async () => {
    const command = executor();
    const loadVersion = vi.fn();
    const currentAuthorization = vi.fn();
    Object.assign(command, {
      inspectPriorCommand: vi.fn().mockResolvedValue({
        kind: "replay",
        aggregateVersion: 4,
      }),
      states: { loadVersion },
      currentAuthorization,
    });

    await expect(
      command.execute({
        commandResource: "core:quotes",
        action: "expire",
        aggregateType: "quote",
        aggregateId,
        expectedVersion: 3,
        payload: {},
        actor: { kind: "user", id: actorId },
        effectiveAccountId: accountId,
        assistedSessionId: null,
        assistedReason: null,
        mfaVerified: true,
        recentAuthenticationVerified: true,
        authorizationCreatedAt: "2026-07-31T00:00:00.000Z",
        idempotencyKey: "portal-action-idempotency-0004",
        requestId: "portal-request-0004",
      }),
    ).resolves.toEqual({
      ok: true,
      aggregateVersion: 4,
      resultReference: `core:quotes:${aggregateId}:version:4`,
      replayed: true,
    });
    expect(loadVersion).not.toHaveBeenCalled();
    expect(currentAuthorization).not.toHaveBeenCalled();
  });
});
