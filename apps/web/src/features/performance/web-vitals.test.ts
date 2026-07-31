import { describe, expect, it } from "vitest";

import { performanceBudgets } from "./web-vitals";

describe("experience performance budgets", () => {
  it("keeps good Core Web Vitals thresholds explicit", () => {
    expect(performanceBudgets.largestContentfulPaintMs).toBeLessThanOrEqual(
      2500,
    );
    expect(performanceBudgets.interactionToNextPaintMs).toBeLessThanOrEqual(
      200,
    );
    expect(performanceBudgets.cumulativeLayoutShift).toBeLessThanOrEqual(0.1);
    expect(performanceBudgets.firstLoadJavaScriptKb).toBeLessThanOrEqual(180);
  });
});
