import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

function submission(body: string, origin = "https://demo.example"): Request {
  return new Request(`${origin}/signing/demo-provider/complete`, {
    method: "POST",
    headers: {
      origin,
      host: new URL(origin).host,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

beforeEach(() => {
  vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
  vi.stubEnv("CLOCKWORK_DEMO_STATE_STORE", "memory");
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => vi.unstubAllEnvs());

describe("demo signing completion", () => {
  it("reads the state from the raw urlencoded body", async () => {
    // The deploy platform's Next runtime does not populate formData() for a
    // route handler, so the handler parses the body text itself.
    const response = await POST(submission("state=opaque-demo-state"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/signing/return?state=opaque-demo-state",
    );
  });

  it("returns to the ceremony when no state was submitted", async () => {
    const response = await POST(submission(""));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/signing/demo-provider");
  });

  it("refuses a cross-origin submission", async () => {
    const request = new Request(
      "https://demo.example/signing/demo-provider/complete",
      {
        method: "POST",
        headers: { origin: "https://attacker.example", host: "demo.example" },
        body: "state=opaque-demo-state",
      },
    );

    expect((await POST(request)).status).toBe(403);
  });

  it("does not exist outside the demo adapter", async () => {
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "database");

    expect((await POST(submission("state=opaque-demo-state"))).status).toBe(
      404,
    );
  });
});
