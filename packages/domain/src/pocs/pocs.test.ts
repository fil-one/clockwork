import { describe, expect, it } from "vitest";

import {
  convertPocInPlace,
  createPocEnvironmentPlan,
  hashPocEvidence,
  pocMilestoneAlerts,
  qualifyPoc,
  summarizePocCost,
} from ".";

function pocSuccessSnapshot(passed = true) {
  const payload = {
    snapshotId: "poc-success-1",
    pocId: "poc-1",
    source: "poc_milestone_ledger" as const,
    evaluatedAt: "2026-08-30T16:00:00.000Z",
    evaluatorId: "solutions-engineer-1",
    tests: [
      {
        testId: "restore-throughput",
        passed,
        evidenceHash: "a".repeat(64),
      },
    ],
  };
  return { ...payload, evidenceHash: hashPocEvidence(payload) };
}

function quoteAcceptance() {
  const payload = {
    quoteId: "quote-1",
    acceptedAt: "2026-08-30T17:00:00.000Z",
    acceptedBy: "buyer-1",
    exactQuoteHash: "b".repeat(64),
  };
  return { ...payload, evidenceHash: hashPocEvidence(payload) };
}

describe("POC lifecycle", () => {
  it("requires a qualified workload and success criteria", () => {
    expect(
      qualifyPoc({
        workload: "x",
        buyerUserId: "",
        permittedDataClass: "synthetic",
        successTests: [],
        commercialRangeMinor: {
          minimum: "100",
          maximum: "10",
          currency: "USD",
        },
        expiresAt: "invalid",
        supportOwnerId: "",
      }),
    ).toMatchObject({ qualified: false });
  });

  it.each(["NaN", "Infinity", "1e3", " 100", "00", "-1"])(
    "reports malformed commercial minor amount %s without throwing a parser error",
    (minimum) => {
      expect(
        qualifyPoc({
          workload: "Restore validation workload",
          buyerUserId: "buyer-1",
          permittedDataClass: "synthetic",
          successTests: [{ id: "restore", description: "Restore succeeds" }],
          commercialRangeMinor: { minimum, maximum: "1000", currency: "USD" },
          expiresAt: "2026-08-31T16:00:00.000Z",
          supportOwnerId: "support-1",
        }),
      ).toMatchObject({
        qualified: false,
        reasons: ["COMMERCIAL_RANGE_INVALID"],
      });
    },
  );

  it("always provisions isolated, capped, expiring sandbox entitlements", () => {
    expect(
      createPocEnvironmentPlan({
        pocId: "poc-1",
        organizationId: "org-1",
        tenantId: "tenant-1",
        capacityCap: "40",
        egressCap: "2",
        permittedDataClass: "confidential",
        keyNames: ["migration", "validation"],
        expiresAt: "2026-08-31T16:00:00.000Z",
        version: 1,
      }),
    ).toMatchObject({
      isolated: true,
      sandboxEntitlement: { zeroPrice: true },
    });
  });

  it.each(["NaN", "Infinity", "1e3", " 10", "00", ".5"])(
    "rejects non-canonical POC cap %s without numeric coercion",
    (capacityCap) => {
      expect(() =>
        createPocEnvironmentPlan({
          pocId: "poc-1",
          organizationId: "org-1",
          tenantId: "tenant-1",
          capacityCap,
          egressCap: "0.25",
          permittedDataClass: "synthetic",
          keyNames: ["test"],
          expiresAt: "2026-08-31T16:00:00.000Z",
          version: 1,
        }),
      ).toThrow("POC_CAP_INVALID");
    },
  );

  it("rejects malformed minor-unit costs before bigint conversion", () => {
    expect(() =>
      summarizePocCost({
        infrastructureCostMinor: "NaN",
        engineeringMinutes: 60,
        engineeringHourlyCostMinor: "10000",
        currency: "USD",
      }),
    ).toThrow("INFRASTRUCTURE_COST_INVALID");
  });

  it("emits each milestone only once", () => {
    expect(
      pocMilestoneAlerts({
        now: "2026-08-15T16:00:00.000Z",
        kickoffAt: "2026-08-01T16:00:00.000Z",
        midpointAt: "2026-08-15T16:00:00.000Z",
        finalReportAt: "2026-08-29T16:00:00.000Z",
        expiresAt: "2026-08-31T16:00:00.000Z",
        proposalLeadDays: 5,
        alreadySent: ["kickoff"],
      }),
    ).toEqual([{ kind: "midpoint", dueAt: "2026-08-15T16:00:00.000Z" }]);
  });

  it("converts by reparenting entitlements without moving tenant data", () => {
    const plan = convertPocInPlace({
      pocId: "poc-1",
      status: "active",
      successSnapshot: pocSuccessSnapshot(),
      quoteId: "quote-1",
      quoteAcceptance: quoteAcceptance(),
      orderId: "order-1",
      organizationId: "org-1",
      tenantId: "tenant-1",
      entitlements: [
        {
          entitlementId: "ent-1",
          sku: "POC-SANDBOX",
          organizationId: "org-1",
          tenantId: "tenant-1",
          paidSku: "LOCKED-STORAGE-TB",
        },
      ],
    });
    expect(plan).toMatchObject({
      preserveData: true,
      organizationId: "org-1",
      tenantId: "tenant-1",
      status: "converted",
    });
    expect(plan.entitlementChanges[0]).toMatchObject({
      entitlementId: "ent-1",
      removeCaps: true,
    });
  });

  it("rejects naked or tampered success assertions during conversion", () => {
    const snapshot = pocSuccessSnapshot();
    expect(() =>
      convertPocInPlace({
        pocId: "poc-1",
        status: "active",
        successSnapshot: {
          ...snapshot,
          tests: snapshot.tests.map((test) => ({ ...test, passed: false })),
        },
        quoteId: "quote-1",
        quoteAcceptance: quoteAcceptance(),
        orderId: "order-1",
        organizationId: "org-1",
        tenantId: "tenant-1",
        entitlements: [],
      }),
    ).toThrow("POC_TESTS_INCOMPLETE");
  });
});
