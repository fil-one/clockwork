import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { createFakeProviderPorts } from "../fakes/providers";
import { TypedLifecycleProviderEffectExecutor } from "./lifecycle-effect-executor";
import {
  DeterministicProviderGateStateStore,
  ProviderRuntime,
  providerRuntimeGateKeys,
  type ProviderGateStateStore,
  type PersistedProviderGateState,
} from "./provider-runtime";

const now = new Date("2026-07-31T16:00:00.000Z");

function active(gateKey: (typeof providerRuntimeGateKeys)[number]) {
  return {
    gateKey,
    activationAllowed: true,
    effectiveStatus: "active",
    rowVersion: 1,
    reviewOn: "2026-08-31",
    updatedAt: now.toISOString(),
  } as const satisfies PersistedProviderGateState;
}

function executor(states = providerRuntimeGateKeys.map(active)) {
  const providers = createFakeProviderPorts();
  const runtime = new ProviderRuntime(
    new DeterministicProviderGateStateStore("test", states),
    () => now,
  );
  return {
    providers,
    effects: new TypedLifecycleProviderEffectExecutor(
      runtime,
      providers,
      (effect) => ({
        environment: "test",
        mode: "simulator",
        boundary: "lifecycle",
        requestId: `request:${effect.aggregateId}`,
        effectId: effect.effectKey,
      }),
    ),
  };
}

function effect(
  effectBoundary:
    | "screening_provider"
    | "notification_provider"
    | "signature_provider"
    | "evidence_provider"
    | "provisioning_provider",
  providerInput: unknown,
) {
  return {
    effectKey: `lifecycle-effect:${effectBoundary}:0001`,
    taskId: "lifecycle-test-v1",
    aggregateId: "10000000-0000-4000-8000-000000000001",
    aggregateVersion: 1,
    effectBoundary,
    persistedState: { providerInput },
  } as const;
}

describe("TypedLifecycleProviderEffectExecutor", () => {
  it("authorizes before claim and invokes all five typed provider boundaries", async () => {
    const { effects, providers } = executor();
    const bytes = new TextEncoder().encode("signed evidence");
    const inputs = [
      effect("screening_provider", {
        accountId: "10000000-0000-4000-8000-000000000001",
        legalName: "Fictional Customer",
        country: "US",
        reason: "registration",
      }),
      effect("notification_provider", {
        template: "lifecycle-reminder",
        recipients: ["operator@example.test"],
        data: { aggregateId: "10000000-0000-4000-8000-000000000001" },
      }),
      effect("signature_provider", {
        accountId: "10000000-0000-4000-8000-000000000001",
        documentId: "40000000-0000-4000-8000-000000000001",
        signerEmail: "signer@example.test",
      }),
      effect("evidence_provider", {
        kind: "agreement",
        bytesBase64: Buffer.from(bytes).toString("base64"),
        contentHash: createHash("sha256").update(bytes).digest("hex"),
        retainUntil: "2033-07-31T16:00:00.000Z",
      }),
      effect("provisioning_provider", {
        operation: "provision",
        orderId: "80000000-0000-4000-8000-000000000001",
        organizationId: "30000000-0000-4000-8000-000000000001",
        entitlements: [
          { sku: "LOCKED-STORAGE-TB", quantity: "1", region: "us-east-2" },
        ],
      }),
    ];
    for (const item of inputs) {
      await expect(effects.authorize(item)).resolves.toBeUndefined();
      await expect(effects.execute(item)).resolves.toMatchObject({ ok: true });
    }
    expect(providers.kernel.calls.map(({ operation }) => operation)).toEqual([
      "screening.screen",
      "notifications.send",
      "signature.createEnvelope",
      "evidence.putImmutable",
      "provisioning.provision",
    ]);
  });

  it("denies an inactive gate before any provider call or ledger claim", async () => {
    const { effects, providers } = executor(
      providerRuntimeGateKeys
        .filter((gateKey) => gateKey !== "EXT-PROVISION-01")
        .map(active),
    );
    const teardown = effect("provisioning_provider", {
      operation: "teardown",
      organizationId: "30000000-0000-4000-8000-000000000001",
      approvalIds: ["approval-1", "approval-2"],
    });
    await expect(effects.authorize(teardown)).rejects.toThrow(
      "PROVIDER_GATE_INACTIVE:EXT-PROVISION-01",
    );
    expect(providers.kernel.calls).toHaveLength(0);
  });

  it("rechecks persisted gates at the last mile after a successful pre-claim authorization", async () => {
    const providers = createFakeProviderPorts();
    let enabled = true;
    const states: ProviderGateStateStore = {
      load: ({ gateKeys }) =>
        Promise.resolve(
          gateKeys.flatMap((gateKey) =>
            enabled
              ? [active(gateKey)]
              : gateKey === "EXT-PROVIDER-01"
                ? []
                : [active(gateKey)],
          ),
        ),
    };
    const effects = new TypedLifecycleProviderEffectExecutor(
      new ProviderRuntime(states, () => now),
      providers,
      (item) => ({
        environment: "test",
        mode: "simulator",
        boundary: "lifecycle",
        requestId: `request:${item.aggregateId}`,
        effectId: item.effectKey,
      }),
    );
    const notification = effect("notification_provider", {
      template: "lifecycle-reminder",
      recipients: ["operator@example.test"],
      data: {},
    });
    await expect(effects.authorize(notification)).resolves.toBeUndefined();
    enabled = false;
    await expect(effects.execute(notification)).rejects.toThrow(
      "PROVIDER_GATE_INACTIVE:EXT-PROVIDER-01",
    );
    expect(providers.kernel.calls).toHaveLength(0);
  });

  it("fails permanently rather than inventing missing provider input", async () => {
    const { effects, providers } = executor();
    await expect(
      effects.execute({
        ...effect("notification_provider", {}),
        persistedState: {},
      }),
    ).resolves.toMatchObject({
      ok: false,
      kind: "permanent",
      code: "LIFECYCLE_PROVIDER_INPUT_INVALID",
    });
    expect(providers.kernel.calls).toHaveLength(0);
  });
});
