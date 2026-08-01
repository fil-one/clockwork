import { IdempotencyKeySchema, ids } from "@clockwork/contracts";
import { describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";

import { HttpProvisioningAdapter } from "../production-adapters";
import type { ProviderJsonTransport } from "../provider-transport";
import { GuardedProviderJsonTransport } from "./guarded-provider-transport";
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
