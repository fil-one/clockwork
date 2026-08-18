import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  handle: vi.fn(),
}));

vi.mock("@/app/api/[[...route]]/demo-app", () => ({
  handleDemoQueueProjectionRefresh: boundary.handle,
}));

import { POST } from "./route";

const request = () =>
  new Request(
    "https://demo.clockwork.test/api/demo/projections/queues/refresh",
    { method: "POST" },
  );

beforeEach(() => {
  vi.clearAllMocks();
  boundary.handle.mockResolvedValue(Response.json({ refreshedRecords: 3 }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("demo queue projection refresh route selection", () => {
  it("does not expose the destination outside the full demo identity", async () => {
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "");
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(boundary.handle).not.toHaveBeenCalled();
  });

  it("forwards the exact request only under the full demo identity", async () => {
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
    const input = request();

    const response = await POST(input);

    expect(response.status).toBe(200);
    expect(boundary.handle).toHaveBeenCalledWith(input);
  });

  it("keeps a platform production marker fail-closed despite the opt-in", async () => {
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
    vi.stubEnv("DEPLOYMENT_ENVIRONMENT", "production");

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(boundary.handle).not.toHaveBeenCalled();
  });
});
