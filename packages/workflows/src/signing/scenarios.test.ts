import { describe, expect, it } from "vitest";
import {
  contractHarness,
  counterpartyPaperHarness,
  mndaHarness,
  unusedDifferences,
  type SigningKind,
} from "./harness";
import { signingScenarios } from "./scenarios";

const harnesses = {
  mnda: mndaHarness,
  contract: () => contractHarness(),
  counterparty_paper: counterpartyPaperHarness,
};

describe.each(["mnda", "contract", "counterparty_paper"] as const)(
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
