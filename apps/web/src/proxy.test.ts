import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import proxy, { config } from "../proxy";

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
  it("leaves both self-authenticating API namespaces outside middleware", () => {
    const entry = config.matcher.at(0);
    if (!entry) throw new Error("Proxy matcher is missing");
    const source = typeof entry === "string" ? entry : entry.source;
    const matcher = new RegExp(`^${source}$`);
    for (const path of [
      "/api/v1/core/commands/orders",
      "/api/v1",
      "/api/experience/projections/customer/quotes",
      "/api/experience",
      "/api/demo/payments",
      "/api/demo/payments/sessions",
      "/api/demo/orders/provision",
      `/demo/quote/${"a".repeat(64)}/respond`,
    ])
      expect(matcher.test(path), path).toBe(false);
    for (const path of [
      "/customer",
      "/api/telemetry",
      "/api/experiential",
      "/api/demo/reset",
      "/api/demo/projections/queues/refresh",
      "/api/demo/paymentss",
      "/api/demo/payments-x",
      "/api/demo/orders",
      "/api/demo/orders/provision-other",
      `/demo/quote/${"a".repeat(64)}`,
      `/demo/quote/${"a".repeat(64)}/respond-other`,
    ])
      expect(matcher.test(path), path).toBe(true);
  });

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
