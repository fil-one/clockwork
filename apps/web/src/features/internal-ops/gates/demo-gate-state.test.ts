import {
  createMemoryDemoStore,
  resetDemoExperience,
} from "@clockwork/testing/demo-reset";
import { describe, expect, it } from "vitest";

import {
  readDemoExternalGates,
  testDemoExternalGateState,
  updateDemoExternalGateState,
} from "./demo-gate-state";

describe("resettable demo external-gate registry", () => {
  it("exposes the complete external-gate inventory", async () => {
    const gates = await readDemoExternalGates({
      now: new Date("2026-08-18T12:00:00.000Z"),
      store: createMemoryDemoStore(),
    });
    expect(gates).toHaveLength(12);
    expect(new Set(gates.map((gate) => gate.gateKey)).size).toBe(12);
  });

  it("persists a policy-evaluated activation test and update", async () => {
    const store = createMemoryDemoStore();
    const now = new Date("2026-08-18T12:00:00.000Z");
    await expect(
      updateDemoExternalGateState({
        gateKey: "EXT-PROVIDER-01",
        expectedRowVersion: 1,
        owner: "Platform operations",
        inputRequired: "Named provider configuration and credential evidence",
        configuredStatus: "active",
        reviewOn: "2026-12-31",
        statusReason: "Provider evidence is ready for review.",
        now,
        store,
      }),
    ).rejects.toMatchObject({ code: "EXTERNAL_GATE_ACTIVATION_DENIED" });

    const tested = await testDemoExternalGateState({
      gateKey: "EXT-PROVIDER-01",
      expectedRowVersion: 1,
      actorId: "20000000-0000-4000-8000-000000000001",
      now,
      store,
    });
    expect(tested).toMatchObject({
      rowVersion: 2,
      lastActivationTestStatus: "passed",
      activationAllowed: false,
    });
    const active = await updateDemoExternalGateState({
      gateKey: "EXT-PROVIDER-01",
      expectedRowVersion: 2,
      owner: "Platform operations",
      inputRequired: "Named provider configuration and credential evidence",
      configuredStatus: "active",
      reviewOn: "2026-12-31",
      statusReason: "Provider evidence passed the repository suite.",
      now,
      store,
    });
    expect(active).toMatchObject({
      rowVersion: 3,
      configuredStatus: "active",
      effectiveStatus: "active",
      activationAllowed: true,
    });
    await expect(readDemoExternalGates({ now, store })).resolves.toContainEqual(
      expect.objectContaining({ gateKey: "EXT-PROVIDER-01", rowVersion: 3 }),
    );
  });

  it("restores the blocked untested registry on reset", async () => {
    const store = createMemoryDemoStore();
    const now = new Date("2026-08-18T12:00:00.000Z");
    await testDemoExternalGateState({
      gateKey: "EXT-PROVIDER-01",
      expectedRowVersion: 1,
      actorId: "20000000-0000-4000-8000-000000000001",
      now,
      store,
    });
    await resetDemoExperience(store, {
      environment: { NODE_ENV: "test", CLOCKWORK_ENV: "demo" },
      target: "demo",
    });
    await expect(readDemoExternalGates({ now, store })).resolves.toContainEqual(
      expect.objectContaining({
        gateKey: "EXT-PROVIDER-01",
        rowVersion: 1,
        lastActivationTestStatus: "never",
        activationAllowed: false,
      }),
    );
  });
});
