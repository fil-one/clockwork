import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import proxy from "../proxy";

vi.mock("@workos-inc/authkit-nextjs", () => ({
  authkitMiddleware: vi.fn(() => vi.fn()),
}));

function event() {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    value: {
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
    },
  };
}

describe("request telemetry proxy", () => {
  it("overwrites an untrusted request ID and uses one ID in both directions", async () => {
    const scheduled = event();
    const response = await proxy(
      new NextRequest("http://localhost:3000/api/v1/core/orders", {
        headers: { "x-request-id": "caller-controlled-request-id" },
      }),
      scheduled.value as never,
    );
    await Promise.all(scheduled.pending);

    const authoritative = response.headers.get("x-request-id");
    expect(authoritative).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(authoritative).not.toBe("caller-controlled-request-id");
    expect(response.headers.get("x-middleware-request-x-request-id")).toBe(
      authoritative,
    );
    expect(response.headers.get("traceparent")).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/,
    );
    expect(scheduled.pending).toHaveLength(1);
  });
});
