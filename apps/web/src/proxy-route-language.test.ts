import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { routeAudienceHeader, routeLocale } from "@/src/i18n/route-language";

vi.mock("@workos-inc/authkit-nextjs", () => ({
  authkitMiddleware: vi.fn(() => vi.fn()),
}));

const proxy = (await import("../proxy")).default;

async function forwardedAudience(
  path: string,
  headers: Record<string, string> = {},
): Promise<string | null> {
  const pending: Promise<unknown>[] = [];
  const response = await proxy(
    new NextRequest(`http://localhost:3000${path}`, { headers }),
    {
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    } as never,
  );
  await Promise.all(pending);
  return response.headers.get(`x-middleware-request-${routeAudienceHeader}`);
}

const request = (values: Record<string, string>) => new Headers(values);

describe("the language a route renders in", () => {
  it("marks staff routes for English and every other route for the reader", async () => {
    expect(await forwardedAudience("/internal")).toBe("staff");
    expect(await forwardedAudience("/internal/operations")).toBe("staff");
    expect(await forwardedAudience("/dashboard")).toBe("reader");
    expect(await forwardedAudience("/partner/quotes")).toBe("reader");
    expect(await forwardedAudience("/internal-notes")).toBe("reader");
  });

  it("replaces an audience the browser sent", async () => {
    expect(
      await forwardedAudience("/dashboard", { [routeAudienceHeader]: "staff" }),
    ).toBe("reader");
  });

  it("renders staff routes in English and others in the reader's language", () => {
    expect(routeLocale("ar", request({ [routeAudienceHeader]: "staff" }))).toBe(
      "en",
    );
    expect(
      routeLocale("ar", request({ [routeAudienceHeader]: "reader" })),
    ).toBe("ar");
  });

  // Server actions, form posts and API calls do not pass through the proxy.
  it("lets the sending page decide when the proxy did not see the request", () => {
    expect(
      routeLocale(
        "ja",
        request({ referer: "https://commerce.test/internal/mndas" }),
      ),
    ).toBe("en");
    expect(
      routeLocale("ja", request({ referer: "https://commerce.test/quotes" })),
    ).toBe("ja");
    expect(routeLocale("ja", request({ referer: "not a url" }))).toBe("ja");
    expect(routeLocale("ja", request({}))).toBe("ja");
  });
});
