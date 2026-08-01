import { describe, expect, it } from "vitest";

import {
  evaluateExternalGate,
  externalGateKeys,
  type ExternalGateKey,
  type ExternalGateRecord,
} from "@clockwork/domain/system";

import {
  DeterministicExternalGateActivationTestRunner,
  deterministicExternalGateActivationSuites,
} from "./external-gate-activation";

function gate(gateKey: ExternalGateKey): ExternalGateRecord {
  return {
    id: crypto.randomUUID(),
    gateKey,
    title: `Gate ${gateKey}`,
    owner: "Test owner",
    inputRequired: "Versioned test input",
    affectedFeature: "Test provider boundary",
    severity: "test",
    configuredStatus: "blocked",
    simulatorState: "ready",
    simulatorDetails: "Deterministic simulator ready",
    inputProvenance: "repository_fixture",
    lastActivationTestStatus: "never",
    lastActivationTestAt: null,
    lastActivationTestedBy: null,
    activationEvidenceReference: null,
    reviewOn: "2099-12-31",
    statusReason: "Awaiting executable activation test",
    rowVersion: 1,
    updatedAt: "2026-07-31T15:00:00.000Z",
  };
}

describe("deterministic external-gate activation runner", () => {
  it("has and executes a typed network-free suite for all 12 gates", async () => {
    const runner = new DeterministicExternalGateActivationTestRunner();
    const testedAt = new Date("2026-07-31T16:00:00.000Z");
    const results = await Promise.all(
      externalGateKeys.map((gateKey) =>
        runner.run({
          gate: evaluateExternalGate(gate(gateKey), testedAt),
          actor: { kind: "user", id: "activation-tester" },
          requestId: `activation-${gateKey}`,
          requestedAt: testedAt,
        }),
      ),
    );

    expect(Object.keys(deterministicExternalGateActivationSuites)).toEqual(
      externalGateKeys,
    );
    expect(results).toHaveLength(12);
    expect(results.every((result) => result.status === "passed")).toBe(true);
    expect(
      results.every(
        (result) =>
          result.simulatorState === "ready" &&
          result.inputProvenance === "repository_fixture" &&
          result.evidenceReference.startsWith("evidence://activation-tests/"),
      ),
    ).toBe(true);
  });

  it("returns configured failure evidence without throwing it away", async () => {
    const runner = new DeterministicExternalGateActivationTestRunner({
      "EXT-PROVISION-01": { status: "failed", simulatorState: "degraded" },
    });
    const requestedAt = new Date("2026-07-31T16:00:00.000Z");
    const result = await runner.run({
      gate: evaluateExternalGate(gate("EXT-PROVISION-01"), requestedAt),
      actor: { kind: "user", id: "activation-tester" },
      requestId: "activation-failure",
      requestedAt,
    });
    expect(result).toMatchObject({
      status: "failed",
      simulatorState: "degraded",
    });
    expect(result.simulatorDetails).toContain("failed");
  });
});
