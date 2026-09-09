import { NextRequest, NextResponse } from "next/server";
import { expect, it, vi } from "vitest";

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@workos-inc/authkit-nextjs", () => ({
  authkitMiddleware: () => authenticate,
}));
vi.stubEnv("WORKOS_API_KEY", "workos-test-api-key");
vi.stubEnv("WORKOS_CLIENT_ID", "workos-test-client-id");
vi.stubEnv(
  "WORKOS_COOKIE_PASSWORD",
  "workos-test-cookie-password-with-enough-length",
);
vi.stubEnv("OTEL_SDK_DISABLED", "true");
const { default: proxy } = await import("../proxy");

it.each(["pkce", "refresh"])(
  "preserves raw WorkOS %s cookies when adding security cookies",
  async (kind) => {
    const authenticated =
      kind === "pkce"
        ? NextResponse.redirect(
            "https://api.workos.com/user_management/authorize",
          )
        : NextResponse.next({
            request: {
              headers: new Headers({
                "x-workos-session": "sealed-session-header",
              }),
            },
          });
    // AuthKit appends directly to headers after constructing its NextResponse.
    const name = kind === "pkce" ? "wos-auth-verifier-01234567" : "wos-session";
    authenticated.headers.append(
      "Set-Cookie",
      `${name}=sealed-provider-value; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Wed, 09 Sep 2026 02:00:00 GMT`,
    );
    authenticate.mockResolvedValue(authenticated);
    const pending: Promise<unknown>[] = [];
    const response = await proxy(
      new NextRequest("https://example.com/internal", {
        headers: { accept: "text/html", "sec-fetch-dest": "document" },
      }),
      {
        waitUntil: (promise: Promise<unknown>) => pending.push(promise),
      } as never,
    );
    await Promise.all(pending);
    const cookies = response.headers.getSetCookie();
    expect(
      cookies.some((cookie) =>
        cookie.startsWith(`${name}=sealed-provider-value;`),
      ),
    ).toBe(true);
    expect(cookies.some((cookie) => cookie.startsWith("clockwork-csrf="))).toBe(
      true,
    );
    expect(
      cookies.some((cookie) => cookie.startsWith("clockwork-telemetry=")),
    ).toBe(true);
    if (kind === "pkce")
      expect(response.headers.get("location")).toBe(
        "https://api.workos.com/user_management/authorize",
      );
    else
      expect(
        response.headers.get("x-middleware-request-x-workos-session"),
      ).toBe("sealed-session-header");
  },
);
