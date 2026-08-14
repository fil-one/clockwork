import { afterEach, describe, expect, it, vi } from "vitest";

import { ProblemDetailsSchema } from "@clockwork/contracts";

vi.mock("@workos-inc/authkit-nextjs", () => ({
  getSignInUrl: vi.fn(() => Promise.resolve("https://auth.example.test/start")),
}));
vi.mock("@/src/auth/session", () => ({
  explicitDemoIdentityEnabled: vi.fn(() => false),
}));

const { GET } = await import("./route");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sign-in entry point", () => {
  it("refuses with an RFC 9457 body when no provider is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WORKOS_API_KEY", "");
    vi.stubEnv("WORKOS_CLIENT_ID", "");
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", "");

    const response = await GET(
      new Request("http://localhost:3000/sign-in", {
        headers: { "x-request-id": "01a00000-0000-7000-8000-000000000001" },
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
    expect(ProblemDetailsSchema.parse(await response.json())).toMatchObject({
      code: "AUTHENTICATION_NOT_CONFIGURED",
      status: 503,
      requestId: "01a00000-0000-7000-8000-000000000001",
      retryable: true,
    });
  });
});
