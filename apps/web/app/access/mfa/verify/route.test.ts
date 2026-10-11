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
  SessionExpiredError: class SessionExpiredError extends Error {},
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
import { SessionExpiredError } from "@/src/auth/session";
import { POST } from "./route";
import { prepareMfaProof } from "../prepared-challenge";
function request(origin = "https://example.com", body = "code=123456") {
  const form = new URLSearchParams(body);
  if (!form.has("proof"))
    form.set(
      "proof",
      prepareMfaProof({
        sessionId: "session",
        workosUserId: "user",
        workosOrganizationId: "org",
        challengeId: "challenge",
        factorId: "factor",
      }).proof,
    );
  return new Request("https://example.com/access/mfa/verify", {
    method: "POST",
    headers: { origin, "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
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
  mocks.factors.mockResolvedValue({
    autoPagination: () =>
      Promise.resolve([{ id: "factor", type: "totp", userId: "user" }]),
  });
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
it("sends an expired session back through the proxy without spending an attempt", async () => {
  mocks.session.mockRejectedValue(new SessionExpiredError());
  expect((await POST(request())).headers.get("location")).toBe(
    "/access/mfa?error=expired",
  );
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
});
it("keeps any other session failure unavailable", async () => {
  mocks.session.mockRejectedValue(
    new Error("WorkOS authentication is required"),
  );
  expect((await POST(request())).headers.get("location")).toBe(
    "/access/mfa?error=unavailable",
  );
  expect(mocks.record).not.toHaveBeenCalled();
});

const reviewDestination =
  "/internal/team?reviewAction=grant&reviewUserId=20000000-0000-4000-8000-000000000001&reviewRole=commerce_admin&reviewVersion=3&reviewActorId=20000000-0000-4000-8000-000000000002";
function reviewRequest(returnTo = reviewDestination, code = "123456") {
  return request(
    "https://example.com",
    new URLSearchParams({ code, returnTo }).toString(),
  );
}

it("returns to the pending Team review only after successful MFA", async () => {
  const response = await POST(reviewRequest());
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(reviewDestination);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.record).toHaveBeenCalledOnce();
});

it.each(["invalid-code", "invalid", "limited", "unavailable", "expired"])(
  "retains the review destination after %s so verification can be retried",
  async (failure) => {
    if (failure === "invalid") mocks.verify.mockResolvedValue({ valid: false });
    if (failure === "limited") mocks.claim.mockResolvedValue(false);
    if (failure === "unavailable")
      mocks.verify.mockRejectedValue(new Error("private detail"));
    if (failure === "expired")
      mocks.session.mockRejectedValue(new SessionExpiredError());
    const response = await POST(
      reviewRequest(
        reviewDestination,
        failure === "invalid-code" ? "bad" : "123456",
      ),
    );
    const location = new URL(
      response.headers.get("location") ?? "",
      "https://example.com",
    );
    expect(location.pathname).toBe("/access/mfa");
    expect(location.searchParams.get("error")).toBe(
      failure === "invalid-code" ? "invalid" : failure,
    );
    expect(location.searchParams.get("returnTo")).toBe(reviewDestination);
    expect(mocks.record).not.toHaveBeenCalled();
  },
);

it.each([
  "https://attacker.example/internal/team",
  "//attacker.example/internal/team",
  "/\\attacker.example/internal/team",
  "/internal/team/../other",
  "/internal/team?x=\\attacker.example",
  "/internal/team?x=%5cattacker.example",
  "/internal/team?x=%0d%0aLocation:https://attacker.example",
  "/internal/team?x=\nheader",
  "/internal/team#fragment",
  "/internal/team?x=%zz",
  "/internal/other",
  "/internal/team?x=" + "a".repeat(700),
])(
  "ignores unsafe return destination %j on success and retry",
  async (returnTo) => {
    expect((await POST(reviewRequest(returnTo))).headers.get("location")).toBe(
      "/",
    );
    expect(
      (await POST(reviewRequest(returnTo, "bad"))).headers.get("location"),
    ).toBe("/access/mfa?error=invalid");
  },
);

it("ignores duplicate return destinations", async () => {
  const body = new URLSearchParams({
    code: "123456",
    returnTo: "/internal/team",
  });
  body.append("returnTo", reviewDestination);
  expect(
    (await POST(request("https://example.com", body.toString()))).headers.get(
      "location",
    ),
  ).toBe("/");
});

it("checks the code before any factor lookup and never creates a challenge after code entry", async () => {
  mocks.verify.mockImplementation(() => {
    expect(mocks.factors).not.toHaveBeenCalled();
    expect(mocks.challenge).not.toHaveBeenCalled();
    return Promise.resolve({
      valid: true,
      challenge: { id: "challenge", authenticationFactorId: "factor" },
    });
  });
  expect((await POST(request())).headers.get("location")).toBe("/");
  expect(mocks.challenge).not.toHaveBeenCalled();
  expect(mocks.record).toHaveBeenCalledOnce();
});
it.each(
  [
    [],
    [{ id: "reset", type: "totp", userId: "user" }],
    [{ id: "factor", type: "totp", userId: "other" }],
    [
      { id: "factor", type: "totp", userId: "user" },
      { id: "other", type: "totp", userId: "user" },
    ],
  ].map((factors) => ({ factors })),
)(
  "refuses a deleted, reset, foreign or ambiguous current factor",
  async ({ factors }) => {
    mocks.factors.mockResolvedValue({
      autoPagination: () => Promise.resolve(factors),
    });
    expect((await POST(request())).headers.get("location")).toBe(
      "/access/mfa?error=unavailable",
    );
    expect(mocks.verify).toHaveBeenCalledOnce();
    expect(mocks.record).not.toHaveBeenCalled();
  },
);
it("does not grant assurance when a challenge receipt is replayed", async () => {
  mocks.record.mockRejectedValue(new Error("duplicate receipt"));
  expect((await POST(request())).headers.get("location")).toBe(
    "/access/mfa?error=unavailable",
  );
  expect(mocks.verify).toHaveBeenCalledOnce();
});
it.each(["", "tampered"])(
  "refuses an absent or invalid binding before any provider call",
  async (proof) => {
    expect(
      (
        await POST(
          request(
            "https://example.com",
            new URLSearchParams({ code: "123456", proof }).toString(),
          ),
        )
      ).headers.get("location"),
    ).toBe("/access/mfa?error=preparation");
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  },
);
it("refuses a proof after switching the signed-in session", async () => {
  mocks.session.mockResolvedValue({
    sessionId: "other",
    organizationId: "org",
    user: { id: "user" },
  });
  expect((await POST(request())).headers.get("location")).toBe(
    "/access/mfa?error=preparation",
  );
  expect(mocks.verify).not.toHaveBeenCalled();
});

it("rejects duplicate proof and code fields before a provider verification", async () => {
  const proof = prepareMfaProof({
    sessionId: "session",
    workosUserId: "user",
    workosOrganizationId: "org",
    challengeId: "challenge",
    factorId: "factor",
  }).proof;
  for (const duplicate of ["code", "proof"]) {
    const form = new URLSearchParams({ code: "123456", proof });
    form.append(duplicate, form.get(duplicate) ?? "");
    expect(
      (await POST(request("https://example.com", form.toString()))).headers.get(
        "location",
      ),
    ).toBe("/access/mfa?error=preparation");
  }
  expect(mocks.verify).not.toHaveBeenCalled();
});
