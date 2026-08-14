import { afterEach, describe, expect, it, vi } from "vitest";

async function headerValues(nodeEnv: string) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  const { default: config } = await import("../next.config");
  const [rule] = (await config.headers?.()) ?? [];
  return new Map((rule?.headers ?? []).map(({ key, value }) => [key, value]));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("application response headers", () => {
  it("pins the deployed origin to https for a year", async () => {
    const headers = await headerValues("production");
    expect(headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    // `preload` is a one-way submission and stays out until it is chosen.
    expect(headers.get("Strict-Transport-Security")).not.toContain("preload");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("never pins a local http development origin", async () => {
    const headers = await headerValues("development");
    expect(headers.has("Strict-Transport-Security")).toBe(false);
  });
});
