import { describe, expect, it } from "vitest";

import {
  allCapabilitiesEnabled,
  capabilityStateFrom,
} from "./capability-state-model";

describe("capability state", () => {
  it("counts only rows that are enabled", () => {
    const state = capabilityStateFrom([
      { capabilityKey: "legal", enabled: true },
      { capabilityKey: "billing", enabled: false },
    ]);
    expect(state.isEnabled("legal")).toBe(true);
    expect(state.isEnabled("billing")).toBe(false);
  });

  it("treats a missing switch as off", () => {
    expect(capabilityStateFrom([]).isEnabled("billing")).toBe(false);
  });

  it("has every switch on for the no-database demo", () => {
    expect(allCapabilitiesEnabled.isEnabled("billing")).toBe(true);
    expect(allCapabilitiesEnabled.isEnabled("new_business")).toBe(true);
  });
});
