import { createClockworkClient } from "@clockwork/api/client";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDemoStatusHandlers, STATUS_ENDPOINTS } from "./handlers";
import { DEMO_ORIGIN } from "./seed";

const server = setupServer(...createDemoStatusHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

describe("generated-contract status handlers", () => {
  it("serves only the three generated status reads through the typed client", async () => {
    const client = createClockworkClient(DEMO_ORIGIN);

    const [core, lifecycle, system] = await Promise.all([
      client.GET(STATUS_ENDPOINTS.core),
      client.GET(STATUS_ENDPOINTS.lifecycle),
      client.GET(STATUS_ENDPOINTS.system),
    ]);

    expect(core.data).toEqual({ lane: "core", status: "ready" });
    expect(lifecycle.data).toEqual({ lane: "lifecycle", status: "ready" });
    expect(system.data).toEqual({ lane: "system", status: "ready" });
    expect(Object.values(STATUS_ENDPOINTS)).toEqual([
      "/v1/core/status",
      "/v1/lifecycle/status",
      "/v1/system/status",
    ]);
  });
});
