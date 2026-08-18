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
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");

    await expect(dispatch()).resolves.toBe("demo");
  });

  it("does not let a stale demo flag replace the production API", async () => {
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "database");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "production");

    await expect(dispatch()).resolves.toBe("hono");
  });

  it("requires the public runtime marker to agree with demo mode", async () => {
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "production");

    await expect(dispatch()).resolves.toBe("hono");
  });

  it("serves the production app when a platform marker reports production", async () => {
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
    vi.stubEnv("VERCEL_ENV", "production");

    await expect(dispatch()).resolves.toBe("hono");
  });
});
