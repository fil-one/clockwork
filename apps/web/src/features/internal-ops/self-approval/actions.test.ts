import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  decide: vi.fn(),
  command: vi.fn(),
}));
vi.mock("@/src/auth/session", () => ({
  requireRecentAuthentication: mocks.session,
  SessionExpiredError: class SessionExpiredError extends Error {},
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@clockwork/db", () => ({
  systemCapabilityKeys: ["new_business"],
  DatabaseSystemCapabilityAdmin: class {
    decide = mocks.decide;
  },
  DatabaseChannelPolicyRepository: class {
    command = mocks.command;
  },
}));

import { SessionExpiredError } from "@/src/auth/session";
import { approveOwnCapability, approveOwnChannelPolicy } from "./actions";

const capability = {
  capabilityKey: "new_business",
  expectedRowVersion: 3,
  proposalId: "019a44ac-0000-7000-8000-000000000001",
  reason: "Board approved the pilot",
};
const policy = {
  id: "019a44ac-0000-7000-8000-000000000002",
  expectedRowVersion: 2,
  reason: "Board approved the change",
  approvalEvidence: "evidence:policy-v4",
};

beforeEach(() => vi.clearAllMocks());

it("reports an expired session apart from a refusal", async () => {
  mocks.session.mockRejectedValue(new SessionExpiredError());
  await expect(approveOwnCapability(capability)).resolves.toEqual({
    ok: false,
    message: "operations.session.expired",
  });
  await expect(approveOwnChannelPolicy(policy)).resolves.toEqual({
    ok: false,
    message: "operations.session.expired",
  });
  expect(mocks.decide).not.toHaveBeenCalled();
  expect(mocks.command).not.toHaveBeenCalled();
});

it("still refuses any other session failure as not permitted", async () => {
  mocks.session.mockRejectedValue(
    new Error("Sensitive action requires recent authentication"),
  );
  await expect(approveOwnCapability(capability)).resolves.toEqual({
    ok: false,
    message: "common.selfApproval.error.notPermitted",
  });
  await expect(approveOwnChannelPolicy(policy)).resolves.toEqual({
    ok: false,
    message: "common.selfApproval.error.notPermitted",
  });
  expect(mocks.decide).not.toHaveBeenCalled();
  expect(mocks.command).not.toHaveBeenCalled();
});
