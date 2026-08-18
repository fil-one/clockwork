import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRecentAuthentication: vi.fn(),
  getOptionalServiceDatabase: vi.fn(),
  classifyDemoReconciliationVariance: vi.fn(),
  record: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/src/auth/session", () => ({
  requireRecentAuthentication: mocks.requireRecentAuthentication,
}));
vi.mock("@/src/db/service", () => ({
  getOptionalServiceDatabase: mocks.getOptionalServiceDatabase,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("./disposition-store", () => ({
  recordVarianceDisposition: mocks.record,
}));
vi.mock("../demo-operator-state", () => ({
  classifyDemoReconciliationVariance: mocks.classifyDemoReconciliationVariance,
}));

import { classifyReconciliationVariance } from "./actions";

const caseId = "01a00a46-9de0-7ced-9bea-6877cf2c8d68";

const operator = {
  userId: "20000000-0000-4000-8000-000000000001",
  accountIds: [],
  roles: ["internal_operator"],
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

function form(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  const values: Record<string, string> = {
    caseId,
    expectedRowVersion: "1",
    classification: "delivery_timing",
    reason: "Stripe payout lands after the cut-off",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values))
    if (value) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOptionalServiceDatabase.mockReturnValue({});
  mocks.requireRecentAuthentication.mockResolvedValue(operator);
  mocks.record.mockResolvedValue({
    caseId,
    classification: "delivery_timing",
    rowVersion: 2,
    blocksClose: false,
  });
  mocks.classifyDemoReconciliationVariance.mockResolvedValue({
    rowVersion: 2,
    blocksClose: false,
  });
});

describe("input the store must never see", () => {
  it("refuses a classification the runbook does not enumerate", async () => {
    expect(
      await classifyReconciliationVariance(
        form({ classification: "rounding" }),
      ),
    ).toEqual({ ok: false, code: "RECONCILIATION_CLASSIFICATION_INVALID" });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("refuses a clearing period that is not a calendar month", async () => {
    expect(
      await classifyReconciliationVariance(
        form({ expectedClearingPeriod: "next quarter" }),
      ),
    ).toEqual({ ok: false, code: "RECONCILIATION_CLEARING_PERIOD_INVALID" });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  /**
   * Both optional fields stay optional. A control that refused the disposition
   * because a clearing period was not yet known would stop the operator
   * recording the one classification that has no clearing period at all.
   */
  it("accepts a disposition with neither optional field", async () => {
    expect(
      await classifyReconciliationVariance(
        form({ classification: "unexplained", expectedClearingPeriod: "" }),
      ),
    ).toEqual({ ok: true, blocksClose: false });
    const passed = mocks.record.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(passed).not.toHaveProperty("expectedClearingPeriod");
    expect(passed).not.toHaveProperty("evidenceReference");
  });

  it("refuses a missing or malformed case version", async () => {
    expect(
      await classifyReconciliationVariance(form({ expectedRowVersion: "0" })),
    ).toEqual({ ok: false, code: "RECONCILIATION_INVALID" });
    expect(
      await classifyReconciliationVariance(form({ expectedRowVersion: "" })),
    ).toEqual({ ok: false, code: "RECONCILIATION_INVALID" });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("refuses a reason too short to be evidence", async () => {
    expect(
      await classifyReconciliationVariance(form({ reason: "no" })),
    ).toEqual({ ok: false, code: "RECONCILIATION_REASON_REQUIRED" });
    expect(mocks.record).not.toHaveBeenCalled();
  });
});

describe("authorization is re-checked at execution", () => {
  it("persists an authorized classification in the exact demo", async () => {
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("CLOCKWORK_ENV", "");
    vi.stubEnv("DEPLOYMENT_ENVIRONMENT", "");
    vi.stubEnv("ENVIRONMENT", "");
    mocks.getOptionalServiceDatabase.mockReturnValue(undefined);

    try {
      await expect(classifyReconciliationVariance(form())).resolves.toEqual({
        ok: true,
        blocksClose: false,
      });
      expect(mocks.classifyDemoReconciliationVariance).toHaveBeenCalledWith(
        expect.objectContaining({
          caseId,
          expectedRowVersion: 1,
          classification: "delivery_timing",
          actorId: operator.userId,
        }),
      );
      expect(mocks.record).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).toHaveBeenCalledWith(
        "/internal/billing-reconciliation",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses when recent authentication has lapsed", async () => {
    mocks.requireRecentAuthentication.mockRejectedValue(new Error("stale"));
    expect(await classifyReconciliationVariance(form())).toEqual({
      ok: false,
      code: "RECONCILIATION_RECENT_AUTH_REQUIRED",
    });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  /**
   * The runbook gives the close to finance and the workflow recovery around it
   * to commerce operations, and neither role holds the other's permission.
   * Admitting only one of them would refuse the other's legitimate work.
   */
  it("admits both the finance approver and the internal operator", async () => {
    for (const role of ["internal_operator", "finance_approver"]) {
      mocks.requireRecentAuthentication.mockResolvedValue({
        ...operator,
        roles: [role],
      });
      expect(await classifyReconciliationVariance(form())).toEqual({
        ok: true,
        blocksClose: false,
      });
    }
  });

  it("refuses a role holding neither permission", async () => {
    mocks.requireRecentAuthentication.mockResolvedValue({
      ...operator,
      roles: ["legal_approver"],
    });
    expect(await classifyReconciliationVariance(form())).toEqual({
      ok: false,
      code: "RECONCILIATION_FORBIDDEN",
    });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("refuses a tenant session that somehow holds billing:approve", async () => {
    mocks.requireRecentAuthentication.mockResolvedValue({
      ...operator,
      isInternalStaff: false,
      roles: ["owner"],
    });
    expect(await classifyReconciliationVariance(form())).toEqual({
      ok: false,
      code: "RECONCILIATION_FORBIDDEN",
    });
    expect(mocks.record).not.toHaveBeenCalled();
  });
});

describe("what the store's refusals become", () => {
  it("names the version conflict and the missing case, and nothing else", async () => {
    mocks.record.mockRejectedValue(
      new Error("RECONCILIATION_VERSION_CONFLICT"),
    );
    expect(await classifyReconciliationVariance(form())).toEqual({
      ok: false,
      code: "RECONCILIATION_VERSION_CONFLICT",
    });

    mocks.record.mockRejectedValue(new Error("RECONCILIATION_CASE_NOT_FOUND"));
    expect(await classifyReconciliationVariance(form())).toEqual({
      ok: false,
      code: "RECONCILIATION_CASE_NOT_FOUND",
    });

    mocks.record.mockRejectedValue(new Error("deadlock detected"));
    expect(await classifyReconciliationVariance(form())).toEqual({
      ok: false,
      code: "RECONCILIATION_FAILED",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("reports an unexplained classification as still blocking", async () => {
    mocks.record.mockResolvedValue({
      caseId,
      classification: "unexplained",
      rowVersion: 4,
      blocksClose: true,
    });
    expect(
      await classifyReconciliationVariance(
        form({ classification: "unexplained" }),
      ),
    ).toEqual({ ok: true, blocksClose: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/internal/billing-reconciliation",
    );
  });
});
