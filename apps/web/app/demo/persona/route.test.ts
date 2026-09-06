import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

beforeEach(() => {
  vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
  vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
});
afterEach(() => vi.unstubAllEnvs());

describe("demo persona redirect contract", () => {
  it("returns the relative destination and private identity cookie", () => {
    const response = GET(
      new Request(
        "http://runtime.internal/demo/persona?persona=directBuyer&ignored=1",
        {
          headers: { "x-forwarded-proto": "https" },
        },
      ),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/dashboard");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.cookies.get("clockwork-demo-persona")).toMatchObject({
      value: "directBuyer",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 43_200,
    });
  });
  it("preserves local HTTP cookie behavior and the selected persona destination", () => {
    const response = GET(
      new Request(
        "http://localhost:3000/demo/persona?persona=internalOperator",
      ),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/internal/queues");
    expect(response.cookies.get("clockwork-demo-persona")).toMatchObject({
      value: "internalOperator",
      secure: false,
    });
  });
  it("redirects unknown personas without issuing an identity cookie", () => {
    const response = GET(
      new Request("https://demo.example/demo/persona?persona=unknown"),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/demo");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("stays unavailable outside the explicit demo deployment", () => {
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "");
    const response = GET(
      new Request("https://app.example/demo/persona?persona=directBuyer"),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
