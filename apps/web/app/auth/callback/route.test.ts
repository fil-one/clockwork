import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieStore: new Map<string, string>(),
  resolveWorkosIdentity: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      set: (name: string, value: string) => mocks.cookieStore.set(name, value),
    }),
}));
vi.mock("@clockwork/db", () => ({
  resolveWorkosIdentity: mocks.resolveWorkosIdentity,
}));
vi.mock("@/src/db/service", () => ({
  getServiceDatabase: () => ({ kind: "test-database" }),
}));

vi.stubEnv("WORKOS_API_KEY", "sk_test_callback");
vi.stubEnv("WORKOS_CLIENT_ID", "client_test_callback");
vi.stubEnv(
  "WORKOS_COOKIE_PASSWORD",
  "callback-test-password-at-least-32-characters",
);
vi.stubEnv("APP_ORIGIN", "https://commerce.example.test");

// Exercise AuthKit's real state validation, session persistence and callback
// error handling. Only the provider's code exchange and commerce DB are faked.
const { getSignInUrl, getWorkOS } = await import("@workos-inc/authkit-nextjs");
const { GET } = await import("./route");

beforeEach(() => {
  mocks.cookieStore.clear();
  mocks.resolveWorkosIdentity.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function callbackRequest(returnTo?: string) {
  const authorizationUrl = new URL(
    await getSignInUrl({
      redirectUri: "https://commerce.example.test/auth/callback",
      ...(returnTo ? { returnTo } : {}),
    }),
  );
  const callbackUrl = new URL("http://container:3000/auth/callback");
  callbackUrl.searchParams.set("code", "test-authorization-code");
  const state = authorizationUrl.searchParams.get("state");
  if (!state) throw new Error("AuthKit did not generate OAuth state");
  callbackUrl.searchParams.set("state", state);
  const request = new NextRequest(callbackUrl);
  for (const [name, value] of mocks.cookieStore)
    request.cookies.set(name, value);
  return request;
}

function successfulCodeExchange(organizationId: string | undefined) {
  return vi
    .spyOn(getWorkOS().userManagement, "authenticateWithCode")
    .mockResolvedValue({
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      authenticationMethod: "MagicAuth",
      ...(organizationId ? { organizationId } : {}),
      user: {
        object: "user",
        id: "user_callback",
        email: "person@example.test",
        emailVerified: true,
        firstName: null,
        lastName: null,
        name: null,
        locale: null,
        profilePictureUrl: null,
        lastSignInAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        externalId: null,
        metadata: {},
      },
    });
}

it.each(["org_callback", undefined])(
  "redirects a verified login without consulting commerce membership (organization: %s)",
  async (organizationId) => {
    successfulCodeExchange(organizationId);
    mocks.resolveWorkosIdentity.mockRejectedValue(
      new Error("Commerce database unavailable"),
    );
    const response = await GET(await callbackRequest());

    expect(mocks.cookieStore.get("wos-session")).toBeTruthy();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://commerce.example.test/",
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("set-cookie")).toContain("wos-auth-verifier-");
    expect(mocks.resolveWorkosIdentity).not.toHaveBeenCalled();
  },
);

it("preserves the requested destination on the configured public origin", async () => {
  successfulCodeExchange("org_callback");
  const response = await GET(await callbackRequest("/internal?tab=activity"));
  expect(response.headers.get("location")).toBe(
    "https://commerce.example.test/internal?tab=activity",
  );
});

it("does not create a session or redirect when the provider rejects the code", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(
    getWorkOS().userManagement,
    "authenticateWithCode",
  ).mockRejectedValue(new Error("Invalid code"));
  const response = await GET(await callbackRequest());
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.headers.get("location")).toBeNull();
  expect(mocks.cookieStore.has("wos-session")).toBe(false);
});

it("rejects mismatched OAuth state before exchanging the code", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const exchange = successfulCodeExchange("org_callback");
  const request = await callbackRequest();
  for (const cookie of request.cookies.getAll())
    request.cookies.set(cookie.name, "wrong-state");
  const response = await GET(request);
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(mocks.cookieStore.has("wos-session")).toBe(false);
  expect(exchange).not.toHaveBeenCalled();
});
