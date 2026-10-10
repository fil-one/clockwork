import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  staff: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@/src/auth/session", () => ({
  explicitDemoIdentityEnabled: () => false,
  getRequestCommerceSession: vi.fn(),
}));
vi.mock("@/src/db/service", () => ({ getOptionalServiceDatabase: () => ({}) }));
vi.mock("../contracts/server", () => ({
  ContractAccessError: class ContractAccessError extends Error {},
  contractStaff: mocks.staff,
  sessionHas: (session: { permissions: string[] }, permission: string) =>
    session.permissions.includes(permission),
}));
vi.mock("../handoff/server", () => ({ handoffRepository: vi.fn() }));
vi.mock("@clockwork/db", () => ({
  OrganizationOnboardingRepository: class {
    get = mocks.get;
  },
  InviteRepository: class {
    list = mocks.list;
  },
}));

import { loadOrganization } from "./server";

const pending = {
  inviteId: "i1",
  email: "lead@bluefin.test",
  role: "owner",
  expiresAt: "2026-10-24T00:00:00.000Z",
  acceptedAt: null,
  state: "pending",
  path: `/invite/${"t".repeat(43)}`,
};

beforeEach(() => {
  vi.stubEnv("AUTHORIZATION_CONTEXT_SECRET", "s".repeat(40));
  mocks.get.mockResolvedValue({ organizationId: "o" });
  mocks.list.mockResolvedValue([pending]);
});

it("shows a pending link only to readers who may invite", async () => {
  mocks.staff.mockResolvedValue({ permissions: ["operations:read"] });
  const reader = await loadOrganization("o");
  expect(reader).toMatchObject({
    kind: "ready",
    value: { canWrite: false, invites: [{ inviteId: "i1", path: null }] },
  });
  mocks.staff.mockResolvedValue({
    permissions: ["operations:read", "operations:write"],
  });
  const operator = await loadOrganization("o");
  expect(operator).toMatchObject({
    kind: "ready",
    value: { canWrite: true, invites: [{ path: pending.path }] },
  });
});
