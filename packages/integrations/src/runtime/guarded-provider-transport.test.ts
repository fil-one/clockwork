import { IdempotencyKeySchema, ids } from "@clockwork/contracts";
import { describe, expect, it, vi } from "vitest";
import { z, type ZodType } from "zod";

import { HttpProvisioningAdapter } from "../production-adapters";
import type { ProviderJsonTransport } from "../provider-transport";
import {
  defaultProviderOperationPolicy,
  GuardedProviderJsonTransport,
} from "./guarded-provider-transport";
import {
  DeterministicProviderGateStateStore,
  ProviderRuntime,
  providerRuntimeGateKeys,
} from "./provider-runtime";

const now = new Date("2026-07-31T16:00:00.000Z");
const active = providerRuntimeGateKeys.map((gateKey) => ({
  gateKey,
  activationAllowed: true,
  effectiveStatus: "active" as const,
  rowVersion: 1,
  reviewOn: "2026-08-31",
  updatedAt: now.toISOString(),
}));

function provisioning(states = active) {
  const request = vi.fn(
    (input: Parameters<ProviderJsonTransport["request"]>[0]) =>
      Promise.resolve(input.response.parse({ operationId: "operation-1" })),
  );
  const transport: ProviderJsonTransport = {
    request<T>(input: {
      operation: string;
      path: string;
      body: Readonly<Record<string, unknown>>;
      response: ZodType<T>;
      idempotencyKey?: string;
    }): Promise<T> {
      return request(input) as Promise<T>;
    },
  };
  const runtime = new ProviderRuntime(
    new DeterministicProviderGateStateStore("test", states),
    () => now,
  );
  const guarded = new GuardedProviderJsonTransport(
    transport,
    runtime,
    (input) => ({
      environment: "test",
      mode: "live",
      boundary: "provider_effect",
      requestId: "provider-request-1",
      effectId: `effect:${input.operation}`,
    }),
  );
  return { adapter: new HttpProvisioningAdapter(guarded), request };
}

const command = {
  orderId: ids.order.parse("80000000-0000-4000-8000-000000000001"),
  organizationId: ids.organization.parse(
    "30000000-0000-4000-8000-000000000001",
  ),
  entitlements: [
    { sku: "LOCKED-STORAGE-TB", quantity: "1", region: "us-east-2" },
  ],
  idempotencyKey: IdempotencyKeySchema.parse("provisioning:order:0001"),
};

describe("GuardedProviderJsonTransport", () => {
  it("authorizes persisted gates immediately before a real adapter invokes transport", async () => {
    const { adapter, request } = provisioning();
    await expect(adapter.provision(command)).resolves.toEqual({
      ok: true,
      value: { operationId: "operation-1" },
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("returns a fail-closed provider result and makes zero transport calls when a gate is absent", async () => {
    const { adapter, request } = provisioning(
      active.filter(({ gateKey }) => gateKey !== "EXT-PROVISION-01"),
    );
    await expect(adapter.provision(command)).resolves.toMatchObject({
      ok: false,
      kind: "permanent",
      code: "PROVIDER_GATE_INACTIVE",
    });
    expect(request).not.toHaveBeenCalled();
  });
});

/**
 * What this guard must NOT be composed over. Both are recorded executably
 * because a gate in the wrong place is worse than no gate, and both would only
 * show up in production: neither adapter has a guarded composition today.
 */
describe("GuardedProviderJsonTransport composition hazards", () => {
  function guarded(states = active) {
    const inner = {
      request: vi.fn((input: Parameters<ProviderJsonTransport["request"]>[0]) =>
        Promise.resolve(input.response.parse({ ok: true })),
      ),
    };
    return {
      inner,
      transport: new GuardedProviderJsonTransport(
        inner as unknown as ProviderJsonTransport,
        new ProviderRuntime(
          new DeterministicProviderGateStateStore("test", states),
          () => now,
        ),
        () => ({
          environment: "test",
          mode: "live",
          boundary: "provider_effect",
          requestId: "provider-request-1",
          effectId: "effect-1",
        }),
      ),
    };
  }

  it("would deadlock the activation probe that activates the gates it checks", async () => {
    // `provider.activation_test` falls through to `provider.effect`, whose
    // gates include EXT-ACC-01 -- the gate the probe exists to turn on.
    expect(
      defaultProviderOperationPolicy({
        operation: "provider.activation_test",
        path: "/v1/activation-tests/run",
        body: {},
      }),
    ).toBe("provider.effect");
    const { transport, inner } = guarded([]);
    await expect(
      transport.request({
        operation: "provider.activation_test",
        path: "/v1/activation-tests/run",
        body: { provider: "billing" },
        response: z.object({ ok: z.boolean() }),
        idempotencyKey: "activation:billing:2026-07-31T16",
      }),
    ).rejects.toThrow("PROVIDER_GATE_INACTIVE");
    expect(inner.request).not.toHaveBeenCalled();
  });

  it("would deny a keyless read the default policy misreads as an effect", async () => {
    // HttpLifecycleEvidenceStorageAdapter.createPresignedDownload sends no
    // idempotency key, and the name matches none of the read heuristics.
    expect(
      defaultProviderOperationPolicy({
        operation: "evidence.create_download",
        path: "/v1/evidence/downloads",
        body: {},
      }),
    ).toBe("provider.effect");
    const { transport, inner } = guarded();
    await expect(
      transport.request({
        operation: "evidence.create_download",
        path: "/v1/evidence/downloads",
        body: {},
        response: z.object({ ok: z.boolean() }),
      }),
    ).rejects.toThrow("PROVIDER_EFFECT_IDEMPOTENCY_REQUIRED");
    expect(inner.request).not.toHaveBeenCalled();
  });
});
