import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  demoEnabled: vi.fn(),
  revalidate: vi.fn(),
  request: vi.fn(),
  resolve: vi.fn(),
  demoRequest: vi.fn(),
  demoResolve: vi.fn(),
}));
vi.mock("@/src/auth/session", () => ({
  requireRecentAuthentication: mocks.session,
}));
vi.mock("@/src/auth/demo-deploy", () => ({
  demoDeployIdentityEnabled: mocks.demoEnabled,
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@clockwork/db", () => ({
  DatabaseCustomerAcquisitionRepository: class {
    request = mocks.request;
    resolve = mocks.resolve;
  },
}));
vi.mock("./demo", () => ({
  DemoCustomerAcquisitionRepository: class {
    request = mocks.demoRequest;
    resolve = mocks.demoResolve;
  },
}));

import {
  resolveCustomerAcquisition,
  submitCustomerAcquisition,
} from "./actions";

const owner = {
  userId: "20000000-0000-4000-8000-000000000002",
  selectedAccountId: "10000000-0000-4000-8000-000000000001",
  providerBacked: true,
  isInternalStaff: false,
  roles: ["owner"],
};
const staff = {
  userId: "20000000-0000-4000-8000-000000000001",
  providerBacked: true,
  isInternalStaff: true,
  roles: ["finance_approver"],
  mfaVerified: true,
};
const request = {
  id: "ab000000-0000-4000-8000-000000000001",
  accountId: owner.selectedAccountId,
  organizationId: "30000000-0000-4000-8000-000000000001",
  kind: "payg",
  offerVersionId: "ab000000-0000-4000-8000-000000000002",
  offerRowVersion: 4,
  offerFingerprint: "a".repeat(64),
  acceptedTerms: true,
};
const resolution = {
  id: request.id,
  expectedRowVersion: 2,
  decision: "fulfilled",
  reason: "Linked separately verified service evidence.",
  enrollmentId: "ab000000-0000-4000-8000-000000000003",
};
const timestamp: unknown = expect.any(String);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.demoEnabled.mockReturnValue(false);
  mocks.session.mockResolvedValue(owner);
  mocks.request.mockResolvedValue({});
  mocks.resolve.mockResolvedValue({});
  mocks.demoRequest.mockResolvedValue({});
  mocks.demoResolve.mockResolvedValue({});
});

describe("customer acquisition action authority", () => {
  it.each([
    { providerBacked: false },
    { isInternalStaff: true },
    { roles: ["member"] },
    { assistedSession: {} },
    { impersonation: {} },
    { authenticationProviderImpersonator: "support-user" },
  ])("refuses unsupported customer authority %j", async (change) => {
    mocks.session.mockResolvedValue({ ...owner, ...change });
    expect(await submitCustomerAcquisition(request)).toMatchObject({
      ok: false,
    });
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.demoRequest).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("rejects another account and forged identity fields before a repository call", async () => {
    expect(
      await submitCustomerAcquisition({
        ...request,
        accountId: "10000000-0000-4000-8000-000000000002",
      }),
    ).toMatchObject({ ok: false });
    expect(
      await submitCustomerAcquisition({
        ...request,
        requestedBy: staff.userId,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await submitCustomerAcquisition({ ...request, acceptedTerms: false }),
    ).toMatchObject({ ok: false });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("binds the actual owner and exact reviewed terms without claiming activation", async () => {
    const result = await submitCustomerAcquisition(request);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("pending verified handoff");
    expect(mocks.request).toHaveBeenCalledWith({
      command: request,
      userId: owner.userId,
      now: timestamp,
    });
    expect(mocks.demoRequest).not.toHaveBeenCalled();
    expect(mocks.revalidate).toHaveBeenCalledWith("/buy/payg");
    expect(mocks.revalidate).toHaveBeenCalledWith("/internal/payg-requests");
  });

  it("keeps cancellation semantics separate from confirmed service termination", async () => {
    const result = await submitCustomerAcquisition({
      id: request.id,
      accountId: request.accountId,
      organizationId: request.organizationId,
      kind: "cancel_payg",
      enrollmentId: resolution.enrollmentId,
      reason: "Please end the verified service.",
    });
    expect(result).toMatchObject({ ok: true });
    expect(result.message).toContain("continue until the provider confirms");
  });

  it("returns actionable stale-offer feedback without a success refresh", async () => {
    mocks.request.mockRejectedValue(new Error("ACQUISITION_OFFER_CHANGED"));
    const result = await submitCustomerAcquisition(request);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("review the current terms");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("never routes an explicit demo acceptance into the live repository", async () => {
    mocks.demoEnabled.mockReturnValue(true);
    mocks.session.mockResolvedValue({ ...owner, providerBacked: false });
    expect(await submitCustomerAcquisition(request)).toMatchObject({
      ok: true,
    });
    expect(mocks.demoRequest).toHaveBeenCalledWith({
      command: request,
      userId: owner.userId,
      now: timestamp,
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

describe("finance request resolution authority", () => {
  it.each([
    { providerBacked: false },
    { isInternalStaff: false },
    { roles: ["internal_operator"] },
    { mfaVerified: false },
    { assistedSession: {} },
    { impersonation: {} },
    { authenticationProviderImpersonator: "support-user" },
  ])("requires direct finance with current MFA %j", async (change) => {
    mocks.session.mockResolvedValue({ ...staff, ...change });
    expect(await resolveCustomerAcquisition(resolution)).toMatchObject({
      ok: false,
    });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.demoResolve).not.toHaveBeenCalled();
  });

  it("retains the reviewed request version and states that linking dispatches no service effect", async () => {
    mocks.session.mockResolvedValue(staff);
    const result = await resolveCustomerAcquisition(resolution);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("No new provider or billing effect");
    expect(mocks.resolve).toHaveBeenCalledWith({
      command: resolution,
      userId: staff.userId,
      now: timestamp,
    });
    expect(mocks.demoResolve).not.toHaveBeenCalled();
  });

  it("does not turn a verified-source mismatch into a completed handoff", async () => {
    mocks.session.mockResolvedValue(staff);
    mocks.resolve.mockRejectedValue(
      new Error("ACQUISITION_VERIFIED_RESULT_REQUIRED"),
    );
    const result = await resolveCustomerAcquisition(resolution);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("must match");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("treats failed recent authentication as a denial for both actions", async () => {
    mocks.session.mockRejectedValue(
      new Error("Recent authentication required"),
    );
    expect(await submitCustomerAcquisition(request)).toMatchObject({
      ok: false,
    });
    expect(await resolveCustomerAcquisition(resolution)).toMatchObject({
      ok: false,
    });
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
