import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCommerceSession: vi.fn(),
  requireRecentAuthentication: vi.fn(),
  getOptionalServiceDatabase: vi.fn(),
  record: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.getCommerceSession,
  requireRecentAuthentication: mocks.requireRecentAuthentication,
}));
vi.mock("@/src/db/service", () => ({
  getOptionalServiceDatabase: mocks.getOptionalServiceDatabase,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("./decision-store", () => ({
  recordUnhandledErrorDecision: mocks.record,
}));

import { decideUnhandledError } from "./actions";
import { unhandledErrorsCopy } from "./copy";
import { containmentReferenceLimit, decisionReasonLimits } from "./model";

const anchor = "01a00a46-9de0-7ced-9bea-6877cf2c8d68";

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
    auditEventId: anchor,
    decision: "contain",
    reason: "EXT-PROVIDER-01 disabled while the provider times out",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values))
    if (value) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOptionalServiceDatabase.mockReturnValue({});
  mocks.requireRecentAuthentication.mockResolvedValue(undefined);
  mocks.getCommerceSession.mockResolvedValue(operator);
  mocks.record.mockResolvedValue({
    auditEventId: anchor,
    decision: "contain",
    recordVersion: 1,
  });
});

describe("input the store must never see", () => {
  it("refuses an anchor that is not a uuid", async () => {
    expect(
      await decideUnhandledError(form({ auditEventId: "not-a-uuid" })),
    ).toEqual({ ok: false, code: "UNHANDLED_ERROR_INVALID" });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("refuses a decision outside the two the surface offers", async () => {
    expect(await decideUnhandledError(form({ decision: "delete" }))).toEqual({
      ok: false,
      code: "UNHANDLED_ERROR_INVALID",
    });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("refuses a reason too short to be evidence", async () => {
    expect(await decideUnhandledError(form({ reason: "no" }))).toEqual({
      ok: false,
      code: "UNHANDLED_ERROR_REASON_REQUIRED",
    });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("refuses a containment reference that is not a reference", async () => {
    expect(
      await decideUnhandledError(
        form({ containmentReference: "gate key; drop table" }),
      ),
    ).toEqual({ ok: false, code: "UNHANDLED_ERROR_EVIDENCE_INVALID" });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  /**
   * The two refusals the previous version made against legitimate input.
   *
   * A ticket URL with a query string and a reference containing a space are the
   * ordinary mid-incident forms of the thing this field asks for, and both were
   * refused by a pattern the help text described only loosely.
   */
  it("accepts the containment references an operator actually has", async () => {
    for (const reference of [
      "https://tickets.test/browse?id=4421",
      "gate EXT-PROVIDER-01",
      "EXT-PROVIDER-01",
      "deploy/2026-08-14.3",
    ]) {
      vi.clearAllMocks();
      mocks.record.mockResolvedValue({
        auditEventId: anchor,
        decision: "contain",
        recordVersion: 1,
      });
      expect(
        await decideUnhandledError(form({ containmentReference: reference })),
        `${reference} was refused`,
      ).toEqual({ ok: true, recordVersion: 1 });
      expect(mocks.record.mock.calls[0]?.[1]).toMatchObject({
        containmentReference: reference,
      });
    }
  });

  /**
   * The cap and the message have to agree. A 501-character reason used to be
   * refused with UNHANDLED_ERROR_REASON_REQUIRED, which copy.ts renders as
   * "Give a reason of at least 8 characters" -- the opposite of what is wrong,
   * told to an operator mid-incident.
   */
  it("distinguishes a reason that is too long from one that is too short", async () => {
    const overLong = "x".repeat(decisionReasonLimits.max + 1);
    expect(await decideUnhandledError(form({ reason: overLong }))).toEqual({
      ok: false,
      code: "UNHANDLED_ERROR_REASON_TOO_LONG",
    });
    expect(mocks.record).not.toHaveBeenCalled();

    expect(
      unhandledErrorsCopy.failures.UNHANDLED_ERROR_REASON_TOO_LONG,
    ).toContain(String(decisionReasonLimits.max));
  });

  it("admits a reason at each end of the stated range", async () => {
    for (const length of [decisionReasonLimits.min, decisionReasonLimits.max]) {
      vi.clearAllMocks();
      mocks.record.mockResolvedValue({
        auditEventId: anchor,
        decision: "contain",
        recordVersion: 1,
      });
      expect(
        await decideUnhandledError(form({ reason: "x".repeat(length) })),
        `a ${length}-character reason was refused`,
      ).toEqual({ ok: true, recordVersion: 1 });
    }
  });

  /**
   * The help text is the only place the operator learns the bounds, so it is
   * held to the constants the refusals are made with rather than written out.
   */
  it("states the bounds it enforces in the help text", () => {
    const reasonHelp = unhandledErrorsCopy.decision.reasonHelp(
      decisionReasonLimits.min,
      decisionReasonLimits.max,
    );
    expect(reasonHelp).toContain(String(decisionReasonLimits.min));
    expect(reasonHelp).toContain(String(decisionReasonLimits.max));
    expect(
      unhandledErrorsCopy.decision.evidenceHelp(containmentReferenceLimit),
    ).toContain(String(containmentReferenceLimit));
  });

  /**
   * A reference is optional. Refusing the decision because one was not supplied
   * would stop a legitimate record over a field the runbook never required.
   */
  it("accepts a decision with no containment reference", async () => {
    expect(
      await decideUnhandledError(form({ containmentReference: "" })),
    ).toEqual({ ok: true, recordVersion: 1 });
    expect(mocks.record.mock.calls[0]?.[1]).not.toHaveProperty(
      "containmentReference",
    );
  });
});

describe("authorization is re-checked at execution", () => {
  it("refuses when recent authentication has lapsed", async () => {
    mocks.requireRecentAuthentication.mockRejectedValue(new Error("stale"));
    expect(await decideUnhandledError(form())).toEqual({
      ok: false,
      code: "UNHANDLED_ERROR_RECENT_AUTH_REQUIRED",
    });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  /**
   * The page that rendered the control is not the authority. A session whose
   * role has since changed is refused even though the button reached it.
   */
  it("refuses a session whose role no longer holds system:operate", async () => {
    mocks.getCommerceSession.mockResolvedValue({
      ...operator,
      roles: ["finance_approver"],
    });
    expect(await decideUnhandledError(form())).toEqual({
      ok: false,
      code: "UNHANDLED_ERROR_FORBIDDEN",
    });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("refuses a session that is not internal staff", async () => {
    mocks.getCommerceSession.mockResolvedValue({
      ...operator,
      isInternalStaff: false,
    });
    expect(await decideUnhandledError(form())).toEqual({
      ok: false,
      code: "UNHANDLED_ERROR_FORBIDDEN",
    });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("refuses when there is no service connection to record against", async () => {
    mocks.getOptionalServiceDatabase.mockReturnValue(undefined);
    expect(await decideUnhandledError(form())).toEqual({
      ok: false,
      code: "UNHANDLED_ERROR_UNAVAILABLE",
    });
  });
});

describe("what the store's refusals become", () => {
  it("names a missing anchor and keeps everything else generic", async () => {
    mocks.record.mockRejectedValue(new Error("UNHANDLED_ERROR_NOT_FOUND"));
    expect(await decideUnhandledError(form())).toEqual({
      ok: false,
      code: "UNHANDLED_ERROR_NOT_FOUND",
    });

    mocks.record.mockRejectedValue(
      new Error('relation "audit_events" does not exist'),
    );
    expect(await decideUnhandledError(form())).toEqual({
      ok: false,
      code: "UNHANDLED_ERROR_FAILED",
    });
  });

  it("revalidates the surface only after a record is written", async () => {
    mocks.record.mockRejectedValue(new Error("UNHANDLED_ERROR_NOT_FOUND"));
    await decideUnhandledError(form());
    expect(mocks.revalidatePath).not.toHaveBeenCalled();

    mocks.record.mockResolvedValue({
      auditEventId: anchor,
      decision: "contain",
      recordVersion: 3,
    });
    expect(await decideUnhandledError(form())).toEqual({
      ok: true,
      recordVersion: 3,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/internal/unhandled-errors",
    );
  });
});
