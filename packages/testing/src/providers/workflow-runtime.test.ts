import { describe, expect, it } from "vitest";

import { lifecycleTaskExecutionSpecs } from "@clockwork/workflows";

import { DeterministicAuthoritativeLifecycleTaskStore } from "./workflow-runtime";

describe("DeterministicAuthoritativeLifecycleTaskStore", () => {
  it("models provider-success/local-failure recovery and committed duplicate replay", async () => {
    const store = new DeterministicAuthoritativeLifecycleTaskStore();
    const [effect] = await store.prepare({
      spec: lifecycleTaskExecutionSpecs["lifecycle-pocs-conversion-v1"],
      aggregateId: "poc-1",
      expectedAggregateVersion: 7,
      scheduled: false,
      requestId: "prepare-1",
    });
    if (!effect) throw new Error("Expected deterministic effect");
    const claim = await store.claimEffect({ effect, requestId: "claim-1" });
    expect(claim.status).toBe("invoke");
    if (claim.status !== "invoke") throw new Error("Expected invoke claim");
    await store.checkpointEffectSuccess({
      effect,
      leaseToken: claim.leaseToken,
      reference: "provider-operation-1",
      output: { operationId: "provider-operation-1" },
      requestId: "checkpoint-1",
    });

    await expect(
      store.claimEffect({ effect, requestId: "claim-after-crash" }),
    ).resolves.toMatchObject({
      status: "provider_succeeded",
      reference: "provider-operation-1",
    });

    await store.finalizeEffect({
      effect,
      leaseToken: claim.leaseToken,
      reference: "provider-operation-1",
      output: { operationId: "provider-operation-1" },
      requestId: "finalize-1",
    });
    await expect(
      store.claimEffect({ effect, requestId: "duplicate-claim" }),
    ).resolves.toMatchObject({
      status: "committed",
      reference: "provider-operation-1",
    });
  });
});
