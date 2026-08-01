import { describe, expect, it } from "vitest";

import { externalGateKeys } from "@clockwork/domain/system";

import {
  createExternalGateActivationSimulator,
  deterministicExternalGateActivationSuites,
} from "./external-gate-simulator";

describe("external-gate activation simulator composition", () => {
  it("is available only when explicitly enabled outside production", () => {
    expect(
      createExternalGateActivationSimulator({
        enabled: true,
        runtimeEnvironment: "development",
      }),
    ).toBeDefined();
    expect(
      createExternalGateActivationSimulator({
        enabled: false,
        runtimeEnvironment: "development",
      }),
    ).toBeUndefined();
    expect(
      createExternalGateActivationSimulator({
        enabled: true,
        runtimeEnvironment: "production",
      }),
    ).toBeUndefined();
    expect(
      createExternalGateActivationSimulator({
        enabled: true,
        runtimeEnvironment: undefined,
      }),
    ).toBeUndefined();
  });

  it("maintains an exhaustive suite map for the registered gates", () => {
    expect(Object.keys(deterministicExternalGateActivationSuites)).toEqual(
      externalGateKeys,
    );
  });

  it.each(["EXT-COMMERCIAL-01", "EXT-TAX-01"] as const)(
    "labels %s results as repository fixtures rather than signed live input",
    async (gateKey) => {
      const simulator = createExternalGateActivationSimulator({
        enabled: true,
        runtimeEnvironment: "test",
      });
      if (!simulator) throw new Error("Expected a test simulator");
      const result = await simulator.run({
        gate: {
          id: crypto.randomUUID(),
          gateKey,
          title: gateKey,
          owner: "test-owner",
          inputRequired: "signed production inputs",
          affectedFeature: "commercial command boundary",
          severity: "blocker",
          configuredStatus: "blocked",
          effectiveStatus: "blocked",
          simulatorState: "ready",
          simulatorDetails: "repository fixtures available",
          inputProvenance: "repository_fixture",
          lastActivationTestStatus: "never",
          lastActivationTestAt: null,
          lastActivationTestedBy: null,
          activationEvidenceReference: null,
          reviewOn: null,
          statusReason: "live signed input absent",
          activationAllowed: false,
          blockedReasons: ["live_signed_input_missing"],
          rowVersion: 1,
          updatedAt: "2026-07-31T16:00:00.000Z",
        },
        actor: { kind: "user", id: "fixture-runner" },
        requestId: `fixture-${gateKey.toLowerCase()}`,
        requestedAt: new Date("2026-07-31T16:00:00.000Z"),
      });
      expect(result).toMatchObject({
        status: "passed",
        simulatorState: "ready",
        inputProvenance: "repository_fixture",
      });
    },
  );
});
