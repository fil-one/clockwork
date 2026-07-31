import { describe, expect, it, vi } from "vitest";

import { readGeneratedLaneStatus } from "./status-client";

describe("generated API client boundary", () => {
  it("reads only the generated lane status contract", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ lane: "system", status: "ready" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      ),
    );
    await expect(
      readGeneratedLaneStatus(
        "https://clockwork.test",
        "system",
        fetchImplementation,
      ),
    ).resolves.toEqual({
      lane: "system",
      status: "ready",
    });
    const request = fetchImplementation.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    expect((request as Request).method).toBe("GET");
  });
});
