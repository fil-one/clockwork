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
});
