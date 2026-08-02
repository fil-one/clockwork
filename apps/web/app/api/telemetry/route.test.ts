import { describe, expect, it, vi } from "vitest";

import { runtimeTelemetrySink } from "@/src/telemetry/runtime";

import { POST } from "./route";

const token = "0123456789abcdef0123456789abcdef";

function record() {
  return {
    schemaUrl: "https://opentelemetry.io/schemas/1.30.0",
    resource: {
      "service.name": "clockwork-web",
      "service.version": "release-1",
      "deployment.environment.name": "test",
    },
    scope: { name: "@clockwork/web", version: "1" },
    signal: "span",
    name: "document.load",
    timeUnixNano: "1722443200000000000",
    trace: {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      parentSpanId: "1111111111111111",
      traceFlags: "01",
    },
    attributes: {
      "app.route": "/accounts/11111111-1111-4111-8111-111111111111?secret=yes",
      password: "do-not-export",
    },
  };
}

function request(body: unknown, csrf = token) {
  return new Request("http://localhost:3000/api/telemetry", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `clockwork-csrf=${token}`,
      origin: "http://localhost:3000",
      "sec-fetch-site": "same-origin",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      "x-clockwork-csrf": csrf,
    },
    body: JSON.stringify(body),
  });
}

describe("browser telemetry ingestion", () => {
  it("accepts a correlated, redacted envelope", async () => {
    expect((await POST(request(record()))).status).toBe(202);
  });

  it("rejects cross-site and unknown signal data", async () => {
    expect((await POST(request(record(), "f".repeat(32)))).status).toBe(403);
    expect(
      (await POST(request({ ...record(), name: "api_key=secret" }))).status,
    ).toBe(422);
  });

  it("rejects non-ASCII and malformed CSRF tokens without throwing", async () => {
    expect((await POST(request(record(), "é".repeat(32)))).status).toBe(403);
    expect((await POST(request(record(), "a".repeat(31)))).status).toBe(403);
  });

  it("records a failed receiver span when the sink cannot deliver", async () => {
    const exported = vi
      .spyOn(runtimeTelemetrySink, "export")
      .mockRejectedValue(new Error("collector unavailable"));
    try {
      expect((await POST(request(record()))).status).toBe(503);
      const browserSpan = exported.mock.calls[0]?.[0]?.[0];
      const receiverSpan = exported.mock.calls.at(-1)?.[0]?.[0];
      expect(browserSpan).toMatchObject({
        name: "document.load",
        parentSpanId: "1111111111111111",
      });
      expect(receiverSpan).toMatchObject({
        name: "api.telemetry_ingest",
        boundary: "api",
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        parentSpanId: "00f067aa0ba902b7",
        status: "error",
      });
      expect(receiverSpan?.attributes["clockwork.outcome"]).toBe("error");
    } finally {
      exported.mockRestore();
    }
  });

  it("rejects an oversized body even when content-length is absent", async () => {
    expect(
      (
        await POST(
          request({
            ...record(),
            attributes: { padding: "x".repeat(33_000) },
          }),
        )
      ).status,
    ).toBe(413);
  });
});
