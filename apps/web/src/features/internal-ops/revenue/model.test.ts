import { describe, expect, it } from "vitest";

import { basisLabel, formatMinor, stageLabel } from "./model";

describe("revenue presentation", () => {
  it("keeps units and basis explicit", () => {
    expect(formatMinor("12345", "USD")).toBe("123.45 USD");
    expect(formatMinor("-5", "EUR")).toBe("-0.05 EUR");
    expect(basisLabel("transfer_price")).toContain("not gross");
    expect(basisLabel("gross")).toBe("Gross");
  });

  it("does not describe pipeline as weighted", () => {
    expect(stageLabel("pipeline")).toBe("Pipeline");
    expect(stageLabel("committed_backlog")).toBe("Contracted backlog");
  });
});
