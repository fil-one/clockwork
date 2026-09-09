import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  claim: vi.fn(),
  record: vi.fn(),
  factors: vi.fn(),
  challenge: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("@clockwork/db", () => ({
  claimMfaAttempt: mocks.claim,
  recordMfaReceipt: mocks.record,
}));
vi.mock("@/src/auth/session", () => ({
  getVerifiedWorkosSession: mocks.session,
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: () => ({}) }));
vi.mock("@workos-inc/authkit-nextjs", () => ({
  getWorkOS: () => ({
    multiFactorAuth: {
      listUserAuthFactors: mocks.factors,
      challengeFactor: mocks.challenge,
      verifyChallenge: mocks.verify,
    },
  }),
}));
import { POST } from "./route";
function request(origin = "https://example.com", body = "code=123456") {
  return new Request("https://example.com/access/mfa/verify", {
    method: "POST",
    headers: { origin, "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_ORIGIN", "https://example.com");
  mocks.session.mockResolvedValue({
    sessionId: "session",
    organizationId: "org",
    user: { id: "user" },
  });
  mocks.claim.mockResolvedValue(true);
  mocks.factors.mockResolvedValue({ data: [{ id: "factor", type: "totp" }] });
  mocks.challenge.mockResolvedValue({ id: "challenge" });
  mocks.verify.mockResolvedValue({
    valid: true,
    challenge: { id: "challenge", authenticationFactorId: "factor" },
  });
});
it("persists only a successful provider challenge bound to the authenticated session", async () => {
  expect((await POST(request())).headers.get("location")).toBe("/");
  expect(mocks.factors).toHaveBeenCalledWith({ userId: "user" });
  expect(mocks.record).toHaveBeenCalledWith(
    {},
    {
      sessionId: "session",
      workosUserId: "user",
      workosOrganizationId: "org",
      challengeId: "challenge",
      factorId: "factor",
    },
  );
});
it.each([
  {
    valid: false,
    challenge: { id: "challenge", authenticationFactorId: "factor" },
  },
  { valid: true, challenge: { id: "other", authenticationFactorId: "factor" } },
  {
    valid: true,
    challenge: { id: "challenge", authenticationFactorId: "other" },
  },
])("rejects invalid or mismatched verification %j", async (result) => {
  mocks.verify.mockResolvedValue(result);
  expect((await POST(request())).headers.get("location")).toBe(
    "/access/mfa?error=invalid",
  );
  expect(mocks.record).not.toHaveBeenCalled();
});
it("enforces the durable per-user attempt budget before provider calls", async () => {
  mocks.claim.mockResolvedValue(false);
  expect((await POST(request())).headers.get("location")).toBe(
    "/access/mfa?error=limited",
  );
  expect(mocks.claim).toHaveBeenCalledWith({}, "user");
  expect(mocks.factors).not.toHaveBeenCalled();
});
it("rejects cross-origin requests before authentication", async () => {
  expect((await POST(request("https://attacker.example"))).status).toBe(403);
  expect(mocks.session).not.toHaveBeenCalled();
});
it("does not bind an impersonated session to the target user's factor", async () => {
  mocks.session.mockResolvedValue({
    sessionId: "session",
    organizationId: "org",
    user: { id: "user" },
    impersonator: { email: "actor@example.com" },
  });
  expect((await POST(request())).status).toBe(403);
  expect(mocks.record).not.toHaveBeenCalled();
});
it("fails closed on provider outage without leaking details", async () => {
  mocks.verify.mockRejectedValue(new Error("sensitive provider detail"));
  expect((await POST(request())).headers.get("location")).toBe(
    "/access/mfa?error=unavailable",
  );
  expect(mocks.record).not.toHaveBeenCalled();
});
