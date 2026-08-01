import { describe, expect, it } from "vitest";

import {
  DeterministicProviderActivationProbe,
  ExecutableProviderActivationRunner,
  executableProviderActivationContracts,
} from "./activation-contracts";
import { providerRuntimeGateKeys } from "./provider-runtime";

describe("executable provider activation contracts", () => {
  it("defines a runnable fail-closed contract for every provider runtime gate", () => {
    expect(Object.keys(executableProviderActivationContracts)).toEqual(
      providerRuntimeGateKeys,
    );
    for (const contract of Object.values(
      executableProviderActivationContracts,
    )) {
      expect(contract.requiredExternalInputs.length).toBeGreaterThan(0);
      expect(contract.checks).toContain("production_target_denial");
      expect(contract.runbook).toMatch(/^docs\/operations\//);
    }
  });

  it("executes deterministic scenarios without fabricating live activation", async () => {
    const runner = new ExecutableProviderActivationRunner({
      environment: "test",
      mode: "simulator",
      probe: new DeterministicProviderActivationProbe("test"),
    });
    const results = await Promise.all(
      providerRuntimeGateKeys.map((gateKey) =>
        runner.run({ gateKey, requestId: `contract-${gateKey}` }),
      ),
    );
    expect(results).toHaveLength(7);
    expect(results.every((result) => result.missingChecks.length === 0)).toBe(
      true,
    );
    expect(results.every((result) => !result.activationEligible)).toBe(true);
    expect(results.every((result) => result.evidenceKind === "simulator")).toBe(
      true,
    );
  });

  it("rejects a simulator runner in production", () => {
    expect(
      () =>
        new ExecutableProviderActivationRunner({
          environment: "production",
          mode: "simulator",
          probe: new DeterministicProviderActivationProbe("test"),
        }),
    ).toThrow("PRODUCTION_ACTIVATION_SIMULATOR_FORBIDDEN");
  });

  it("requires every live check before staging evidence is activation eligible", async () => {
    const runner = new ExecutableProviderActivationRunner({
      environment: "staging",
      mode: "live",
      probe: {
        run: (input) =>
          Promise.resolve({
            evidenceKind: "live_staging",
            targetEnvironment: "staging",
            targetFingerprint: "a".repeat(32),
            testedAt: "2026-07-31T16:00:00.000Z",
            testedBy: "staging-runner",
            evidenceReference: "urn:clockwork:activation:partial",
            passedChecks: input.checks.slice(1),
            details: "First expected denial did not execute",
          }),
      },
    });
    await expect(
      runner.run({ gateKey: "EXT-ACC-01", requestId: "live-partial" }),
    ).resolves.toMatchObject({
      activationEligible: false,
      missingChecks: ["bounded_authenticated_probe"],
    });
  });
});
