import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./demo-app", () => ({
  handle: () => Promise.resolve(new Response("demo")),
}));
vi.mock("./hono-app", () => ({
  handle: () => Promise.resolve(new Response("hono")),
}));

async function dispatch(): Promise<string> {
  vi.resetModules();
  const { POST } = await import("./route");
  return (
    await POST(new Request("https://clockwork.test/api/v1/core/status"))
  ).text();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("commerce api selection", () => {
  it("serves the production app when the demo opt-in is absent", async () => {
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "");

    await expect(dispatch()).resolves.toBe("hono");
  });

  it("serves the demo simulators under the exact opt-in", async () => {
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
    vi.stubEnv("NODE_ENV", "production");

    await expect(dispatch()).resolves.toBe("demo");
  });

  it("serves the production app when a platform marker reports production", async () => {
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
    vi.stubEnv("VERCEL_ENV", "production");

    await expect(dispatch()).resolves.toBe("hono");
  });
});
