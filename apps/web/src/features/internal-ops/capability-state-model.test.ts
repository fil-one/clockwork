import { describe, expect, it } from "vitest";

import { portalCommandActions } from "@clockwork/workflows";

import {
  allCapabilitiesEnabled,
  availableActions,
  capabilityStateFrom,
  isActive,
} from "./capability-state-model";

const switches = (
  billing: { enabled: boolean; recoveryEnabled: boolean },
  others = { enabled: true, recoveryEnabled: true },
) =>
  capabilityStateFrom([
    { capabilityKey: "billing", ...billing },
    ...["new_business", "legal", "partner", "marketplace", "teardown"].map(
      (capabilityKey) => ({ capabilityKey, ...others }),
    ),
  ]);

describe("capability state", () => {
  it("reads the enabled and recovery halves separately", () => {
    const state = switches({ enabled: false, recoveryEnabled: true });
    expect(state.isEnabled("billing")).toBe(false);
    expect(state.isRecoveryEnabled("billing")).toBe(true);
    expect(isActive(state, "billing")).toBe(true);
  });

  it("treats a missing switch as off for both halves", () => {
    const state = capabilityStateFrom([]);
    expect(state.isEnabled("billing")).toBe(false);
    expect(state.isRecoveryEnabled("billing")).toBe(false);
    expect(isActive(state, "billing")).toBe(false);
  });

  it("has every switch on for the no-database demo", () => {
    expect(allCapabilitiesEnabled.isEnabled("billing")).toBe(true);
    expect(allCapabilitiesEnabled.isRecoveryEnabled("billing")).toBe(true);
  });
});

describe("available record actions", () => {
  it("offers dunning evaluation on billing recovery alone, as the server checks it", () => {
    const recoveryOnly = switches({ enabled: false, recoveryEnabled: true });
    expect(
      availableActions("invoice", ["create", "evaluate_dunning"], recoveryOnly),
    ).toEqual(["evaluate_dunning"]);
    const newOnly = switches({ enabled: true, recoveryEnabled: false });
    expect(
      availableActions("invoice", ["create", "evaluate_dunning"], newOnly),
    ).toEqual(["create"]);
  });

  it("needs billing for order work but not for quote or account work", () => {
    const off = switches({ enabled: false, recoveryEnabled: false });
    expect(availableActions("order", ["prepare_artifact"], off)).toEqual([]);
    expect(availableActions("quote", ["issue", "expire"], off)).toEqual([
      "issue",
      "expire",
    ]);
    expect(availableActions("account", ["set_payment_terms"], off)).toEqual([
      "set_payment_terms",
    ]);
  });

  it("needs new business and legal for quote and account work", () => {
    const state = capabilityStateFrom([
      { capabilityKey: "billing", enabled: true, recoveryEnabled: true },
      { capabilityKey: "legal", enabled: true, recoveryEnabled: true },
    ]);
    expect(availableActions("quote", ["issue"], state)).toEqual([]);
    expect(availableActions("account", ["set_payment_terms"], state)).toEqual(
      [],
    );
  });

  it("leaves non-core work, such as exception review, to its own checks", () => {
    const off = capabilityStateFrom([]);
    expect(
      availableActions("exception_case", ["review_exception"], off),
    ).toEqual(["review_exception"]);
  });

  /**
   * Every action the portal can offer is filtered through the same
   * requirement the command transaction enforces. With every switch off,
   * nothing a core resource accepts may stay available.
   */
  it("withholds every portal command when every switch is off", () => {
    const off = capabilityStateFrom([]);
    const aggregates: Readonly<Record<string, string>> = {
      accounts: "account",
      quotes: "quote",
      orders: "order",
      amendments: "amendment",
      invoices: "invoice",
    };
    for (const [resource, actions] of Object.entries(portalCommandActions)) {
      const aggregate = aggregates[resource];
      expect(aggregate, resource).toBeDefined();
      expect(availableActions(aggregate as string, actions, off)).toEqual([]);
    }
  });
});
