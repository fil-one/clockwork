import { describe, expect, it } from "vitest";
import {
  contractHarness,
  mndaHarness,
  unusedDifferences,
  type SigningKind,
} from "./harness";
import { signingScenarios } from "./scenarios";

const harnesses = { mnda: mndaHarness, contract: contractHarness };

describe.each(["mnda", "contract"] as const)(
  "%s signing",
  (kind: SigningKind) => {
    it.each(signingScenarios)("$name", (scenario) =>
      scenario.run(harnesses[kind]),
    );
    it("reaches every expected difference it lists", () => {
      expect(unusedDifferences(kind)).toEqual([]);
    });
  },
);
