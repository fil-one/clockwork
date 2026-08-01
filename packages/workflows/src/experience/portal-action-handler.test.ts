import { describe, expect, it, vi } from "vitest";

import {
  createPortalActionOutboxHandlers,
  PortalActionHandler,
  portalActionQueuedTopic,
  type AuthoritativePortalCommandPort,
  type PersistedPortalActionRequest,
  type PortalActionRetryableError,
  type PortalActionPersistencePort,
} from "./portal-action-handler";

const now = new Date("2026-08-01T12:00:00.000Z");
const actionRequestId = "91000000-0000-4000-8000-000000000001";
const projectionId = "91000000-0000-4000-8000-000000000002";
const aggregateId = "91000000-0000-4000-8000-000000000003";
const eventId = "91000000-0000-4000-8000-000000000004";

function request(
  overrides: Partial<PersistedPortalActionRequest> = {},
): PersistedPortalActionRequest {
  return {
    id: actionRequestId,
    projectionId,
    aggregateType: "quote",
    aggregateId,
    commandResource: "core:quotes",
    action: "accept_quote",
    expectedVersion: 3,
    actor: {
      kind: "user",
      id: "20000000-0000-4000-8000-000000000001",
    },
    effectiveAccountId: "10000000-0000-4000-8000-000000000001",
    assistedSessionId: null,
    assistedReason: null,
    mfaVerified: true,
    recentAuthenticationVerified: true,
    idempotencyKey: "portal-action-idempotency-0001",
    payload: { reason: "Customer accepted the authoritative quote" },
    createdAt: now.toISOString(),
    ...overrides,
  };
}

function delivery() {
  return {
    messageId: "91000000-0000-4000-8000-000000000005",
    eventId,
    topic: portalActionQueuedTopic,
    payload: {
      eventId,
      actionRequestId,
      projectionId,
      aggregateType: "quote",
      aggregateId,
      action: "accept_quote",
      expectedVersion: 3,
    },
    idempotencyKey: "outbox:portal-action-message-0001",
  };
}

function dependencies(overrides: {
  claimedRequest?: PersistedPortalActionRequest;
  commandResult?: Awaited<
    ReturnType<AuthoritativePortalCommandPort["execute"]>
  >;
}) {
  const claim = vi.fn<PortalActionPersistencePort["claim"]>(() =>
    Promise.resolve({
      status: "claimed",
      claimToken: "claim-token-portal-action-0001",
      attempt: 1,
      request: overrides.claimedRequest ?? request(),
    }),
  );
  const finish = vi.fn<PortalActionPersistencePort["finish"]>((input) =>
    Promise.resolve(input.outcome),
  );
  const release = vi.fn<PortalActionPersistencePort["release"]>(() =>
    Promise.resolve(),
  );
  const execute = vi.fn<AuthoritativePortalCommandPort["execute"]>(() =>
    Promise.resolve(
      overrides.commandResult ?? {
        ok: true,
        aggregateVersion: 4,
        resultReference: `quote:${aggregateId}:version:4`,
        replayed: false,
      },
    ),
  );
  return {
    persistence: { claim, finish, release },
    commands: { execute },
    spies: { claim, finish, release, execute },
  };
}

describe("portal action handler", () => {
  it("executes the authoritative version-bound command and atomically finishes", async () => {
    const { persistence, commands, spies } = dependencies({});
    const handler = new PortalActionHandler(persistence, commands, () => now);
    await expect(handler.handle(delivery())).resolves.toMatchObject({
      status: "completed",
      replayed: false,
      outcome: {
        status: "applied",
        code: "PORTAL_ACTION_APPLIED",
        authoritativeVersion: 4,
      },
    });
    expect(spies.execute).toHaveBeenCalledOnce();
    const command = spies.execute.mock.calls[0]?.[0];
    if (!command) throw new Error("Expected authoritative command input");
    expect(command).toMatchObject({
      commandResource: "core:quotes",
      action: "accept_quote",
      aggregateId,
      expectedVersion: 3,
      idempotencyKey: actionRequestId,
    });
    expect(spies.finish).toHaveBeenCalledOnce();
    expect(spies.release).not.toHaveBeenCalled();
  });

  it("persists an authoritative stale-version rejection", async () => {
    const { persistence, commands, spies } = dependencies({
      commandResult: {
        ok: false,
        code: "AUTHORITATIVE_VERSION_CONFLICT",
        resultReference: "aggregate-version:4",
        authoritativeVersion: 4,
        disposition: "rejected",
        retryable: false,
      },
    });
    const handler = new PortalActionHandler(persistence, commands, () => now);
    await expect(handler.handle(delivery())).resolves.toMatchObject({
      outcome: {
        status: "rejected",
        code: "AUTHORITATIVE_VERSION_CONFLICT",
        authoritativeVersion: 4,
      },
    });
    expect(spies.execute).toHaveBeenCalledOnce();
    expect(spies.finish).toHaveBeenCalledOnce();
  });

  it("passes authorization time to the replay-aware command boundary", async () => {
    const { persistence, commands, spies } = dependencies({
      claimedRequest: request({
        createdAt: "2026-08-01T11:54:59.999Z",
      }),
      commandResult: {
        ok: false,
        code: "PORTAL_ACTION_AUTHORIZATION_EXPIRED",
        resultReference: `authoritative-command:${aggregateId}:authorization-expired`,
        authoritativeVersion: null,
        disposition: "rejected",
        retryable: false,
      },
    });
    const handler = new PortalActionHandler(persistence, commands, () => now);
    await expect(handler.handle(delivery())).resolves.toMatchObject({
      outcome: {
        status: "rejected",
        code: "PORTAL_ACTION_AUTHORIZATION_EXPIRED",
        authoritativeVersion: null,
      },
    });
    expect(spies.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationCreatedAt: "2026-08-01T11:54:59.999Z",
      }),
    );
    expect(spies.finish).toHaveBeenCalledOnce();
  });

  it("fails a forged event/request binding without invoking command truth", async () => {
    const { persistence, commands, spies } = dependencies({
      claimedRequest: request({ action: "expire_quote" }),
    });
    const handler = new PortalActionHandler(persistence, commands, () => now);
    await expect(handler.handle(delivery())).resolves.toMatchObject({
      outcome: {
        status: "failed",
        code: "PORTAL_ACTION_EVENT_BINDING_INVALID",
      },
    });
    expect(spies.execute).not.toHaveBeenCalled();
  });

  it("returns an existing legacy terminal result without inventing replay truth", async () => {
    const { persistence, commands, spies } = dependencies({});
    spies.claim.mockResolvedValueOnce({
      status: "terminal",
      actionRequestId,
      outcome: {
        status: "applied",
        code: "PORTAL_ACTION_APPLIED",
        resultReference: `quote:${aggregateId}:version:4`,
        authoritativeVersion: 4,
        commandReplayed: null,
      },
    });
    const handler = new PortalActionHandler(persistence, commands, () => now);
    await expect(handler.handle(delivery())).resolves.toMatchObject({
      status: "terminal",
      replayed: true,
      outcome: { commandReplayed: null },
    });
    expect(spies.execute).not.toHaveBeenCalled();
    expect(spies.finish).not.toHaveBeenCalled();
  });

  it("releases retryable provider failures for an idempotent redelivery", async () => {
    const { persistence, commands, spies } = dependencies({
      commandResult: {
        ok: false,
        code: "AUTHORITATIVE_API_UNAVAILABLE",
        resultReference: "provider:authoritative-api:unavailable",
        authoritativeVersion: 3,
        disposition: "failed",
        retryable: true,
      },
    });
    const handler = new PortalActionHandler(persistence, commands, () => now);
    await expect(handler.handle(delivery())).rejects.toEqual(
      expect.objectContaining<Partial<PortalActionRetryableError>>({
        code: "AUTHORITATIVE_API_UNAVAILABLE",
      }),
    );
    expect(spies.finish).not.toHaveBeenCalled();
    expect(spies.release).toHaveBeenCalledOnce();
    const released = spies.release.mock.calls[0]?.[0];
    expect(released?.failureCode).toBe("AUTHORITATIVE_API_UNAVAILABLE");
  });

  it("registers only the persisted portal action topic", async () => {
    const { persistence, commands, spies } = dependencies({});
    const handlers = createPortalActionOutboxHandlers({
      persistence,
      commands,
      clock: () => now,
    });
    expect([...handlers.keys()]).toEqual([portalActionQueuedTopic]);
    const handler = handlers.get(portalActionQueuedTopic);
    if (!handler) throw new Error("Expected portal action outbox handler");
    await handler(delivery());
    expect(spies.execute).toHaveBeenCalledOnce();
  });
});
