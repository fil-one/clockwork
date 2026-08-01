import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";

const { authFailure, authkitProxy, telemetrySpan } = vi.hoisted(() => {
  const failure = new Error("provider authentication unavailable");
  return {
    authFailure: failure,
    authkitProxy: vi.fn(() => Promise.reject(failure)),
    telemetrySpan: {
      context: vi.fn(() => ({
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
        traceFlags: "01" as const,
      })),
      setAttributes: vi.fn(),
      recordError: vi.fn(),
      end: vi.fn(() => Promise.resolve()),
    },
  };
});

vi.mock("@workos-inc/authkit-nextjs", () => ({
  authkitMiddleware: vi.fn(() => authkitProxy),
}));

vi.mock("@/src/telemetry/runtime", () => ({
  runtimeTelemetry: { startSpan: vi.fn(() => telemetrySpan) },
}));

vi.stubEnv("WORKOS_API_KEY", "workos-test-api-key");
vi.stubEnv("WORKOS_CLIENT_ID", "workos-test-client-id");
vi.stubEnv("WORKOS_COOKIE_PASSWORD", "workos-test-cookie-password");

const { default: proxy } = await import("../proxy");

it("ends the server span without replacing an authentication provider error", async () => {
  const pending: Promise<unknown>[] = [];
  const event = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
  };

  await expect(
    proxy(
      new NextRequest("http://localhost:3000/internal/dashboard"),
      event as never,
    ),
  ).rejects.toBe(authFailure);
  expect(authkitProxy).toHaveBeenCalledOnce();
  expect(telemetrySpan.recordError).toHaveBeenCalledWith(authFailure);
  expect(telemetrySpan.setAttributes).toHaveBeenLastCalledWith({
    "clockwork.outcome": "error",
    "http.response.status_code": 500,
  });
  expect(telemetrySpan.end).toHaveBeenCalledWith("error");
  expect(pending).toHaveLength(1);
  await expect(Promise.all(pending)).resolves.toEqual([undefined]);
});
