import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  revalidate: vi.fn(),
  repository: {
    create: vi.fn(),
    take: vi.fn(),
    complete: vi.fn(),
    decline: vi.fn(),
  },
}));
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.session,
  explicitDemoIdentityEnabled: () => false,
  SessionExpiredError: class SessionExpiredError extends Error {},
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("./server", () => ({ handoffRepository: () => mocks.repository }));

import { decideHandoff, requestHandoff } from "./actions";

const userId = "019a44ac-0000-7000-8000-0000000000aa";
const as = (role: string, patch: Record<string, unknown> = {}) =>
  mocks.session.mockResolvedValue({
    userId,
    profile: { name: "Pat Seller", email: "pat@fil.one" },
    roles: [role],
    isInternalStaff: true,
    mfaVerified: true,
    ...patch,
  });
const request = {
  id: "019a44ac-0000-7000-8000-0000000000e1",
  version: 1,
  status: "open",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.repository.create.mockResolvedValue(request);
  mocks.repository.take.mockResolvedValue({
    ...request,
    version: 2,
    status: "in_progress",
  });
});

describe("requestHandoff", () => {
  it("lets a seller hand a contract to operations as themselves", async () => {
    as("revenue");
    await expect(requestHandoff({ id: request.id })).resolves.toEqual({
      ok: true,
      value: { id: request.id, version: 1 },
    });
    expect(mocks.repository.create).toHaveBeenCalledWith(
      { id: request.id },
      { kind: "user", id: userId, display: "Pat Seller" },
      { anyScenario: false },
    );
    expect(mocks.revalidate).toHaveBeenCalledWith("/internal/handoffs");
  });

  it("lets only a commerce administrator attach another seller's scenario", async () => {
    as("commerce_admin");
    await requestHandoff({ id: request.id });
    expect(mocks.repository.create).toHaveBeenLastCalledWith(
      { id: request.id },
      expect.objectContaining({ id: userId }),
      { anyScenario: true },
    );
  });

  it("refuses roles without contract:write and sessions without MFA", async () => {
    as("finance_approver");
    await expect(requestHandoff({})).resolves.toEqual({
      ok: false,
      code: "CONTRACT_FORBIDDEN",
    });
    as("revenue", { mfaVerified: false });
    await expect(requestHandoff({})).resolves.toEqual({
      ok: false,
      code: "CONTRACT_MFA_REQUIRED",
    });
    as("revenue", { impersonation: { accountId: "a" } });
    await expect(requestHandoff({})).resolves.toEqual({
      ok: false,
      code: "CONTRACT_FORBIDDEN",
    });
    expect(mocks.repository.create).not.toHaveBeenCalled();
  });

  it("passes the database's refusal through as its code", async () => {
    as("revenue");
    mocks.repository.create.mockRejectedValue(
      new Error("HANDOFF_ALREADY_REQUESTED"),
    );
    await expect(requestHandoff({})).resolves.toEqual({
      ok: false,
      code: "HANDOFF_ALREADY_REQUESTED",
    });
  });
});

describe("decideHandoff", () => {
  it("lets internal operators and commerce administrators work the queue", async () => {
    for (const role of ["internal_operator", "commerce_admin"]) {
      as(role);
      await expect(
        decideHandoff("take", { id: request.id, expectedVersion: 1 }),
      ).resolves.toEqual({
        ok: true,
        value: { id: request.id, version: 2, status: "in_progress" },
      });
    }
    expect(mocks.repository.take).toHaveBeenCalledTimes(2);
  });

  it("refuses sellers and approvers, who lack operations:write", async () => {
    for (const role of ["revenue", "legal_approver", "finance_approver"]) {
      as(role);
      await expect(
        decideHandoff("decline", { id: request.id, expectedVersion: 1 }),
      ).resolves.toEqual({ ok: false, code: "CONTRACT_FORBIDDEN" });
    }
    expect(mocks.repository.decline).not.toHaveBeenCalled();
  });

  it("lets only a commerce administrator complete a request someone else took", async () => {
    mocks.repository.complete.mockResolvedValue({ ...request, status: "done" });
    as("internal_operator");
    await decideHandoff("complete", { id: request.id, expectedVersion: 2 });
    expect(mocks.repository.complete).toHaveBeenLastCalledWith(
      { id: request.id, expectedVersion: 2 },
      expect.objectContaining({ id: userId }),
      { anyAssignee: false },
    );
    as("commerce_admin");
    await decideHandoff("complete", { id: request.id, expectedVersion: 2 });
    expect(mocks.repository.complete).toHaveBeenLastCalledWith(
      { id: request.id, expectedVersion: 2 },
      expect.objectContaining({ id: userId }),
      { anyAssignee: true },
    );
  });

  it("refuses a decision it does not know", async () => {
    as("internal_operator");
    await expect(
      decideHandoff("delete" as "take", { id: request.id }),
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
  });
});
