import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  blockingVariances,
  blocksClose,
  clearingPeriodPattern,
  formatMinor,
  isVarianceClassification,
  reconciliationQueue,
  untiedPeriods,
  varianceClassificationLabels,
  varianceClassifications,
  type ReconciliationVariance,
  type TieOutPeriod,
} from "./model";

const root = (() => {
  for (const candidate of [path.join(process.cwd(), "..", ".."), process.cwd()])
    if (existsSync(path.join(candidate, "packages", "workflows", "src")))
      return candidate;
  throw new Error(
    `Could not locate the workspace root from ${process.cwd()}; the queue binding would pass without reading anything.`,
  );
})();

function variance(
  overrides: Partial<ReconciliationVariance> = {},
): ReconciliationVariance {
  return {
    caseId: "11111111-1111-4111-8111-111111111111",
    accountId: "22222222-2222-4222-8222-222222222222",
    objectType: "invoice",
    objectId: "33333333-3333-4333-8333-333333333333",
    status: "open",
    openedAt: "2026-08-01T00:00:00.000Z",
    targetAt: "2026-08-02T00:00:00.000Z",
    ownerUserId: "44444444-4444-4444-8444-444444444444",
    ownerEmail: null,
    backupUserId: null,
    rowVersion: 1,
    latestClassification: null,
    latestClassificationReason: null,
    latestClassificationAt: null,
    expectedClearingPeriod: null,
    ...overrides,
  };
}

function period(overrides: Partial<TieOutPeriod> = {}): TieOutPeriod {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    periodStartsOn: "2026-07-01",
    periodEndsOn: "2026-07-31",
    currency: "USD",
    platformRevenueMinor: "100000",
    billingProviderRevenueMinor: "100000",
    accountingRevenueMinor: "100000",
    billingProviderVarianceMinor: "0",
    accountingVarianceMinor: "0",
    mathematicallyTied: true,
    status: "matched",
    varianceCount: 0,
    reviewedAt: null,
    ...overrides,
  };
}

/**
 * The queue name is the join between this surface and the two reconciliation
 * tasks. Spelled wrong, the surface reads an empty list forever and looks like
 * a clean close, which is the worst possible failure for a finance page.
 */
describe("the reconciliation queue is the one the platform raises", () => {
  it("is a member of the single exception-queue vocabulary", () => {
    // `@clockwork/domain` is not a dependency of this application, so the
    // vocabulary is read from its source rather than restated here. The
    // database check constraint that enforces the same list is asserted too,
    // because the two disagreeing is the defect P0-43 closed.
    const vocabulary = readFileSync(
      path.join(root, "packages/domain/src/exceptions/index.ts"),
      "utf8",
    );
    expect(vocabulary).toContain(`"${reconciliationQueue}"`);
    const constraint = readFileSync(
      path.join(
        root,
        "supabase/migrations/001395_exception_queue_vocabulary.sql",
      ),
      "utf8",
    );
    expect(constraint).toContain(`'${reconciliationQueue}'`);
  });

  it("is the queue the three-way task opens its exception on", () => {
    const engine = readFileSync(
      path.join(root, "packages/workflows/src/core/engine.ts"),
      "utf8",
    );
    expect(engine).toContain(`queue: "${reconciliationQueue}"`);
    expect(engine).toContain("THREE_WAY_TIE_OUT_VARIANCE");
  });
});

describe("variance classification", () => {
  it("covers the ten the runbook enumerates and nothing else", () => {
    expect(varianceClassifications).toHaveLength(10);
    for (const value of varianceClassifications)
      expect(varianceClassificationLabels[value]).toBeTruthy();
    expect(isVarianceClassification("delivery_timing")).toBe(true);
    expect(isVarianceClassification("resolved")).toBe(false);
  });

  /**
   * "A close requires zero unexplained variance." Recording one as unexplained
   * has to be possible -- that is how the blocker is written down -- and it has
   * to keep blocking.
   */
  it("accepts unexplained and keeps it blocking", () => {
    expect(isVarianceClassification("unexplained")).toBe(true);
    expect(blocksClose("unexplained")).toBe(true);
    expect(blocksClose("delivery_timing")).toBe(false);
  });

  it("counts unclassified and unexplained cases as blocking the close", () => {
    const blocking = blockingVariances([
      variance(),
      variance({
        caseId: "66666666-6666-4666-8666-666666666666",
        latestClassification: "unexplained",
      }),
      variance({
        caseId: "77777777-7777-4777-8777-777777777777",
        latestClassification: "delivery_timing",
      }),
    ]);
    expect(blocking.map((item) => item.caseId)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "66666666-6666-4666-8666-666666666666",
    ]);
  });
});

describe("expected clearing period", () => {
  it("accepts a calendar month and refuses anything else", () => {
    expect(clearingPeriodPattern.test("2026-09")).toBe(true);
    expect(clearingPeriodPattern.test("2026-13")).toBe(false);
    expect(clearingPeriodPattern.test("2026-9")).toBe(false);
    expect(clearingPeriodPattern.test("next quarter")).toBe(false);
  });
});

describe("stored tie-out periods", () => {
  it("reports a period as untied from the stored variance, not from the status", () => {
    expect(
      untiedPeriods([
        period(),
        period({
          id: "88888888-8888-4888-8888-888888888888",
          // A row whose status says `resolved` while its own totals still
          // differ. The status is a label; the variance columns are the fact.
          status: "resolved",
          accountingRevenueMinor: "99000",
          accountingVarianceMinor: "1000",
          mathematicallyTied: false,
        }),
      ]).map((item) => item.id),
    ).toEqual(["88888888-8888-4888-8888-888888888888"]);
  });

  it("renders minor units without inventing a locale or a symbol", () => {
    expect(formatMinor("100000", "USD")).toBe("1000.00 USD");
    expect(formatMinor("-1000", "EUR")).toBe("-10.00 EUR");
    expect(formatMinor("5", "GBP")).toBe("0.05 GBP");
    expect(formatMinor("0", "USD")).toBe("0.00 USD");
  });
});
