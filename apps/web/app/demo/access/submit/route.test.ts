import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const password = "open-sesame-2026";

beforeEach(() => {
  vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
  vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
  vi.stubEnv("CLOCKWORK_DEMO_ACCESS_PASSWORD", password);
});
afterEach(() => vi.unstubAllEnvs());

function submit(fields: Record<string, string>): Promise<Response> {
  return POST(
    new Request("https://demo.example/demo/access/submit", {
      method: "POST",
      headers: {
        origin: "https://demo.example",
        host: "demo.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields).toString(),
    }),
  );
}

describe("language chosen at the demo gate", () => {
  it("travels with the password into the demo", async () => {
    const response = await submit({ password, next: "/demo", language: "fr" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/demo");
    const cookies = response.headers.getSetCookie();
    expect(
      cookies.find((value) => value.startsWith("clockwork-language=")),
    ).toMatch(
      /^clockwork-language=fr;.*Max-Age=31536000.*HttpOnly.*SameSite=lax/iu,
    );
  });

  it("holds through a refused password, so the retry reads in that language", async () => {
    const response = await submit({
      password: "wrong-password-2026",
      next: "/demo",
      language: "ja",
    });
    expect(response.headers.get("location")).toBe(
      "/demo/access?error=1&next=%2Fdemo",
    );
    expect(response.headers.getSetCookie().join("\n")).toMatch(
      /^clockwork-language=ja;/mu,
    );
  });

  it("ignores an unsupported or prototype-shaped language", async () => {
    for (const language of ["xx", "__proto__", "constructor", ""]) {
      const response = await submit({ password, next: "/demo", language });
      expect(response.headers.getSetCookie().join("\n")).not.toMatch(
        /clockwork-language=/u,
      );
    }
  });
});
