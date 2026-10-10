import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  command: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/src/auth/session", () => ({
  requireRecentAuthentication: mocks.session,
  SessionExpiredError: class SessionExpiredError extends Error {},
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@clockwork/db", () => ({
  DatabaseChannelPolicyRepository: class {
    command = mocks.command;
  },
}));
vi.mock(
  "@/src/features/internal-ops/commercial-policies/demo-policies",
  () => ({ DemoCommercialPolicyRepository: class {} }),
);

import { SessionExpiredError } from "@/src/auth/session";
import { changeChannelPolicy } from "./actions";

beforeEach(() => vi.clearAllMocks());

it("reports an expired session and leaves every other refusal thrown", async () => {
  mocks.session.mockRejectedValueOnce(new SessionExpiredError());
  expect(await changeChannelPolicy("", new FormData())).toBe(
    "operations.session.expired",
  );
  mocks.session.mockRejectedValueOnce(new Error("stale"));
  await expect(changeChannelPolicy("", new FormData())).rejects.toThrow(
    "stale",
  );
  expect(mocks.command).not.toHaveBeenCalled();
});
