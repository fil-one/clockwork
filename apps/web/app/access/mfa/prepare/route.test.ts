import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  claim: vi.fn(),
  factors: vi.fn(),
  challenge: vi.fn(),
  pages: vi.fn(),
}));
vi.mock("@clockwork/db", () => ({ claimMfaPreparationAttempt: mocks.claim }));
vi.mock("@/src/auth/session", () => ({
  getVerifiedWorkosSession: mocks.session,
  SessionExpiredError: class SessionExpiredError extends Error {},
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: () => ({}) }));
vi.mock("@workos-inc/authkit-nextjs", () => ({
  getWorkOS: () => ({
    multiFactorAuth: {
      listUserAuthFactors: mocks.factors,
      challengeFactor: mocks.challenge,
    },
  }),
}));
import { POST } from "./route";
import { readMfaProof } from "../prepared-challenge";
const binding = {
  sessionId: "session",
  workosUserId: "user",
  workosOrganizationId: "org",
};
function request(origin = "https://example.com") {
  return new Request("https://example.com/access/mfa/prepare", {
    method: "POST",
    headers: { origin, "content-type": "application/x-www-form-urlencoded" },
    body: "",
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_ORIGIN", "https://example.com");
  vi.stubEnv(
    "WORKOS_COOKIE_PASSWORD",
    "test-cookie-key-with-at-least-32-bytes",
  );
  mocks.session.mockResolvedValue({
    sessionId: "session",
    organizationId: "org",
    user: { id: "user" },
  });
  mocks.claim.mockResolvedValue(true);
  mocks.pages.mockResolvedValue([
    { id: "factor", type: "totp", userId: "user" },
  ]);
  mocks.factors.mockResolvedValue({ autoPagination: mocks.pages });
  mocks.challenge.mockResolvedValue({
    id: "challenge",
    authenticationFactorId: "factor",
    code: "never-expose",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
});
it("prepares an owned factor using every page without returning a provider code", async () => {
  const response = await POST(request());
  const body = (await response.json()) as { proof: string; validForMs: number };
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(readMfaProof(body.proof, binding)).toMatchObject({
    ...binding,
    factorId: "factor",
    challengeId: "challenge",
  });
  expect(JSON.stringify(body)).not.toContain("never-expose");
  expect(mocks.pages).toHaveBeenCalledOnce();
  expect(mocks.claim).toHaveBeenCalledWith({}, "user");
});
it("refuses cross-origin preparation before session/provider calls", async () => {
  expect((await POST(request("https://other.example"))).status).toBe(403);
  expect(mocks.session).not.toHaveBeenCalled();
});
it("bounds preparation separately before provider requests", async () => {
  mocks.claim.mockResolvedValue(false);
  expect((await POST(request())).status).toBe(429);
  expect(mocks.factors).not.toHaveBeenCalled();
});
it.each(
  [
    [],
    [{ id: "factor", type: "totp", userId: "other" }],
    [
      { id: "a", type: "totp", userId: "user" },
      { id: "b", type: "totp", userId: "user" },
    ],
  ].map((factors) => ({ factors })),
)("rejects unavailable or ambiguous factor ownership", async ({ factors }) => {
  mocks.pages.mockResolvedValue(factors);
  expect((await POST(request())).status).toBe(409);
  expect(mocks.challenge).not.toHaveBeenCalled();
});
it("refuses a mismatched provider challenge", async () => {
  mocks.challenge.mockResolvedValue({
    id: "challenge",
    authenticationFactorId: "other",
  });
  expect((await POST(request())).status).toBe(503);
});
it("sanitizes provider failure", async () => {
  mocks.challenge.mockRejectedValue(new Error("private provider error"));
  expect(await (await POST(request())).json()).toEqual({
    error: "unavailable",
  });
});
it("refuses impersonation before preparation", async () => {
  mocks.session.mockResolvedValue({
    sessionId: "session",
    organizationId: "org",
    user: { id: "user" },
    impersonator: {},
  });
  expect((await POST(request())).status).toBe(403);
  expect(mocks.claim).not.toHaveBeenCalled();
});

it.each([
  { sessionId: "", organizationId: "org" },
  { sessionId: "session", organizationId: "" },
])("requires a complete authenticated session binding", async (binding) => {
  mocks.session.mockResolvedValue({ ...binding, user: { id: "user" } });
  expect((await POST(request())).status).toBe(403);
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.factors).not.toHaveBeenCalled();
});
it("reports an expired session without spending preparation budget", async () => {
  const { SessionExpiredError } = await import("@/src/auth/session");
  mocks.session.mockRejectedValue(new SessionExpiredError());
  expect(await (await POST(request())).json()).toEqual({ error: "expired" });
  expect(mocks.claim).not.toHaveBeenCalled();
});
it("exports no GET handler for render or prefetch preparation", async () => {
  expect(await import("./route")).not.toHaveProperty("GET");
});
