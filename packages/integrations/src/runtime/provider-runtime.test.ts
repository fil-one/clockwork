import { describe, expect, it, vi } from "vitest";

import {
  DeterministicProviderGateStateStore,
  ProviderRuntime,
  PersistedProviderGateStateStore,
  ProviderEffectBoundaryExecutor,
  providerRuntimeGateKeys,
  type PersistedProviderGateState,
} from "./provider-runtime";

const now = new Date("2026-07-31T16:00:00.000Z");

function active(gateKey: (typeof providerRuntimeGateKeys)[number]) {
  return {
    gateKey,
    activationAllowed: true,
    effectiveStatus: "active",
    rowVersion: 3,
    reviewOn: "2026-08-31",
    updatedAt: now.toISOString(),
  } as const satisfies PersistedProviderGateState;
}

function runtime(
  states: readonly PersistedProviderGateState[] = providerRuntimeGateKeys.map(
    active,
  ),
) {
  return new ProviderRuntime(
    new DeterministicProviderGateStateStore("test", states),
    () => now,
  );
}

const context = {
  environment: "test",
  mode: "simulator",
  boundary: "provider_effect",
  requestId: "request-provider-1",
  effectId: "effect-provider-1",
  idempotencyKey: "provider:effect:0001",
} as const;

describe("ProviderRuntime", () => {
  it("loads every required persisted gate before invoking a new effect", async () => {
    const invoke = vi.fn(() => Promise.resolve("provider-reference"));
    await expect(
      runtime().execute({
        operation: "provisioning.teardown",
        context,
        invoke,
      }),
    ).resolves.toBe("provider-reference");
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        mayInvokeProvider: true,
        mayCreateEffectOutbox: true,
        gateVersions: {
          "EXT-ACC-01": 3,
          "EXT-PROVIDER-01": 3,
          "EXT-PROVISION-01": 3,
          "EXT-APPROVERS-01": 3,
          "EXT-TEARDOWN-01": 3,
        },
      }),
    );
  });

  it.each([
    [
      "missing",
      providerRuntimeGateKeys
        .filter((key) => key !== "EXT-PROVISION-01")
        .map(active),
    ],
    [
      "inactive",
      providerRuntimeGateKeys.map((key) =>
        key === "EXT-PROVISION-01"
          ? {
              ...active(key),
              activationAllowed: false,
              effectiveStatus: "blocked" as const,
            }
          : active(key),
      ),
    ],
    [
      "expired",
      providerRuntimeGateKeys.map((key) =>
        key === "EXT-PROVISION-01"
          ? { ...active(key), reviewOn: "2026-07-30" }
          : active(key),
      ),
    ],
    [
      "emergency disabled",
      providerRuntimeGateKeys.map((key) =>
        key === "EXT-PROVISION-01"
          ? {
              ...active(key),
              activationAllowed: false,
              effectiveStatus: "emergency_disabled" as const,
            }
          : active(key),
      ),
    ],
  ])("fails closed when required state is %s", async (_label, states) => {
    const invoke = vi.fn(() => Promise.resolve("forbidden"));
    await expect(
      runtime(states).execute({
        operation: "provisioning.provision",
        context,
        invoke,
      }),
    ).rejects.toThrow("PROVIDER_GATE_INACTIVE:EXT-PROVISION-01");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("denies simulators in production before reading or invoking a provider", async () => {
    const load = vi.fn(() =>
      Promise.resolve(providerRuntimeGateKeys.map(active)),
    );
    const invoke = vi.fn(() => Promise.resolve("forbidden"));
    const guarded = new ProviderRuntime({ load }, () => now);
    await expect(
      guarded.execute({
        operation: "provider.effect",
        context: { ...context, environment: "production" },
        invoke,
      }),
    ).rejects.toThrow("PRODUCTION_SIMULATOR_FORBIDDEN");
    expect(load).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps internal recovery available without permitting a provider effect or outbox", async () => {
    const guarded = new ProviderRuntime({
      load: () => Promise.reject(new Error("register unavailable")),
    });
    await expect(
      guarded.execute({
        operation: "recovery.internal",
        context: { ...context, boundary: "recovery" },
        invoke: (authorization) => Promise.resolve(authorization),
      }),
    ).resolves.toMatchObject({
      mayInvokeProvider: false,
      mayCreateEffectOutbox: false,
      gateVersions: {},
    });
  });

  it("denies generic provider recovery from silently creating a new effect", async () => {
    const invoke = vi.fn(() => Promise.resolve("forbidden"));
    await expect(
      runtime().execute({
        operation: "provider.effect",
        context: { ...context, boundary: "recovery" },
        invoke,
      }),
    ).rejects.toThrow("RECOVERY_EFFECT_FORBIDDEN");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("requires persisted approver activation before teardown", async () => {
    const invoke = vi.fn(() => Promise.resolve("forbidden"));
    await expect(
      runtime(
        providerRuntimeGateKeys
          .filter((gateKey) => gateKey !== "EXT-APPROVERS-01")
          .map(active),
      ).execute({
        operation: "provisioning.teardown",
        context,
        invoke,
      }),
    ).rejects.toThrow("PROVIDER_GATE_INACTIVE:EXT-APPROVERS-01");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("adapts persisted gate views and treats unknown status as unavailable", async () => {
    const store = new PersistedProviderGateStateStore(
      {
        list: () =>
          Promise.resolve([
            active("EXT-ACC-01"),
            {
              ...active("EXT-PROVIDER-01"),
              effectiveStatus: "unexpected_status",
            },
          ]),
      },
      () => now,
    );
    await expect(
      store.load({
        gateKeys: ["EXT-ACC-01", "EXT-PROVIDER-01"],
        requestId: "persisted-view-1",
      }),
    ).resolves.toEqual([
      active("EXT-ACC-01"),
      {
        ...active("EXT-PROVIDER-01"),
        effectiveStatus: "unavailable",
      },
    ]);
  });

  it("creates neither provider call nor effect/outbox persistence when authorization denies", async () => {
    const invoke = vi.fn(() => Promise.resolve({ providerId: "forbidden" }));
    const persist = vi.fn(() => Promise.resolve({ outboxId: "forbidden" }));
    const executor = new ProviderEffectBoundaryExecutor(
      runtime(
        providerRuntimeGateKeys
          .filter((key) => key !== "EXT-PROVIDER-01")
          .map(active),
      ),
    );
    await expect(
      executor.execute({
        operation: "provider.effect",
        context,
        invoke,
        persist,
      }),
    ).rejects.toThrow("PROVIDER_GATE_INACTIVE:EXT-PROVIDER-01");
    expect(invoke).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});
