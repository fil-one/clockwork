import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  revalidate: vi.fn(),
  repository: {
    save: vi.fn(),
    saveDeal: vi.fn(),
    dealConflicts: vi.fn(),
  },
}));
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.session,
  explicitDemoIdentityEnabled: () => false,
  SessionExpiredError: class SessionExpiredError extends Error {},
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("./server", () => ({
  partnerRepository: () => mocks.repository,
  partnerReader: () => mocks.repository,
  partnerToday: () => "2026-10-10",
}));

import {
  findPartnerDealConflicts,
  savePartner,
  savePartnerDeal,
} from "./actions";

const userId = "019a44ac-0000-7000-8000-0000000000aa";
const partnerId = "019a44ac-0000-7000-8000-0000000000b1";
const as = (role: string, patch: Record<string, unknown> = {}) =>
  mocks.session.mockResolvedValue({
    userId,
    profile: { name: "Pat Seller", email: "pat@fil.one" },
    roles: [role],
    isInternalStaff: true,
    mfaVerified: true,
    ...patch,
  });
const conflict = {
  dealId: "019a44ac-0000-7000-8000-0000000000d2",
  partnerId: "019a44ac-0000-7000-8000-0000000000b2",
  partnerName: "Southwind",
  endClient: "ACME Inc",
  status: "registered",
  registeredOn: "2026-10-01",
  protectedUntil: "2026-12-30",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.repository.save.mockResolvedValue({ id: partnerId, version: 2 });
  mocks.repository.saveDeal.mockResolvedValue({
    deal: { id: "d1", partnerId, version: 1, status: "registered" },
    conflicts: [conflict],
  });
  mocks.repository.dealConflicts.mockResolvedValue([conflict]);
});

describe("savePartner", () => {
  it("saves as the signed-in seller and refreshes the list", async () => {
    as("revenue");
    await expect(savePartner({ id: partnerId })).resolves.toEqual({
      ok: true,
      value: { id: partnerId, version: 2 },
    });
    expect(mocks.repository.save).toHaveBeenCalledWith(
      { id: partnerId },
      { kind: "user", id: userId, display: "Pat Seller" },
    );
    expect(mocks.revalidate).toHaveBeenCalledWith("/internal/partners");
  });

  it("refuses roles without contract:write, sessions without MFA and assisted sessions", async () => {
    as("finance_approver");
    await expect(savePartner({})).resolves.toEqual({
      ok: false,
      code: "CONTRACT_FORBIDDEN",
    });
    as("revenue", { mfaVerified: false });
    await expect(savePartner({})).resolves.toEqual({
      ok: false,
      code: "CONTRACT_MFA_REQUIRED",
    });
    as("commerce_admin", { assistedSession: { accountId: "a" } });
    await expect(savePartner({})).resolves.toEqual({
      ok: false,
      code: "CONTRACT_FORBIDDEN",
    });
    expect(mocks.repository.save).not.toHaveBeenCalled();
  });

  it("returns the refusal code the repository raised", async () => {
    as("revenue");
    mocks.repository.save.mockRejectedValue(
      new Error("PARTNER_VERSION_CONFLICT"),
    );
    await expect(savePartner({ id: partnerId })).resolves.toEqual({
      ok: false,
      code: "PARTNER_VERSION_CONFLICT",
    });
  });
});

describe("savePartnerDeal", () => {
  it("saves the deal and hands back overlapping registrations without blocking", async () => {
    as("commerce_admin");
    await expect(savePartnerDeal({ id: "d1" })).resolves.toEqual({
      ok: true,
      value: {
        id: "d1",
        version: 1,
        status: "registered",
        conflicts: [conflict],
      },
    });
    expect(mocks.repository.saveDeal).toHaveBeenCalledWith(
      { id: "d1" },
      expect.objectContaining({ id: userId }),
      "2026-10-10",
    );
    expect(mocks.revalidate).toHaveBeenCalledWith(
      `/internal/partners/${partnerId}`,
    );
  });
});

describe("findPartnerDealConflicts", () => {
  it("looks up other partners' open registrations for any sales reader", async () => {
    as("finance_approver");
    await expect(
      findPartnerDealConflicts({ endClient: "Acme, Inc.", partnerId }),
    ).resolves.toEqual({ ok: true, value: [conflict] });
    expect(mocks.repository.dealConflicts).toHaveBeenCalledWith("Acme, Inc.", {
      excludePartnerId: partnerId,
      today: "2026-10-10",
    });
  });

  it("skips the lookup for an empty name and refuses roles outside sales", async () => {
    as("revenue");
    await expect(
      findPartnerDealConflicts({ endClient: "  ", partnerId }),
    ).resolves.toEqual({ ok: true, value: [] });
    as("destructive_action_approver");
    await expect(
      findPartnerDealConflicts({ endClient: "Acme", partnerId }),
    ).resolves.toEqual({ ok: false, code: "CONTRACT_FORBIDDEN" });
  });
});
