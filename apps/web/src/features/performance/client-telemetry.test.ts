import { describe, expect, it } from "vitest";

import {
  BrowserOpenTelemetry,
  parseTraceparent,
  redactTelemetryAttributes,
  sanitizeRoute,
  type OpenTelemetryRecord,
} from "./client-telemetry";

describe("browser OpenTelemetry boundary", () => {
  it("accepts only canonical W3C traceparent values", () => {
    expect(
      parseTraceparent(
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      ),
    ).toMatchObject({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: "01",
    });
    for (const invalid of [
      undefined,
      "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
      "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
      "00-not-a-trace-00f067aa0ba902b7-01",
      "ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    ]) {
      expect(parseTraceparent(invalid)).toBeNull();
    }
  });

  it("removes query strings, identifiers, secrets, email, and unapproved keys", () => {
    expect(
      sanitizeRoute(
        "/accounts/11111111-1111-4111-8111-111111111111?email=maya@example.com&token=secret",
      ),
    ).toBe("/accounts/:id");
    expect(
      redactTelemetryAttributes({
        "app.route": "/quotes/opaque_quote_identifier_123456789?secret=yes",
        "error.type": "Bearer topsecret for maya@example.com",
        email: "maya@example.com",
        password: "unsafe",
        accountId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toEqual({
      "app.route": "/quotes/:id",
      "error.type": "RedactedError",
    });
    expect(
      sanitizeRoute(
        "https://user:password@example.test/orders/ORD-2026-001?phone=2125550198#api_key_sk_test_123",
      ),
    ).toBe("/orders/:id");
    expect(
      redactTelemetryAttributes({
        "error.type": "api_key=sk_live_secret 212-555-0198",
        "web_vital.name": "maya@example.com",
        "web_vital.rating": "token_abcdef123456",
        "navigation.type": "Bearer secret",
      }),
    ).toEqual({
      "error.type": "RedactedError",
      "web_vital.name": "unknown",
      "web_vital.rating": "unknown",
      "navigation.type": "unknown",
    });
  });

  it("correlates every client signal to the validated server trace", () => {
    const exported: OpenTelemetryRecord[] = [];
    const telemetry = new BrowserOpenTelemetry({
      exporter: {
        export: (record) => {
          exported.push(record);
        },
      },
      parentTraceparent:
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      environment: "test",
      serviceVersion: "abc123",
      now: () => 1_722_443_200_000,
      randomValues: (target) => target.fill(0xab),
    });

    const record = telemetry.metric("web_vital.lcp", 1234, {
      "app.route": "/dashboard?account=private",
      "web_vital.name": "LCP",
      cookie: "do-not-export",
    });

    expect(exported).toEqual([record]);
    expect(record.trace).toEqual({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      parentSpanId: "00f067aa0ba902b7",
      spanId: "abababababababab",
      traceFlags: "01",
    });
    expect(record.attributes).toEqual({
      "app.route": "/dashboard",
      "web_vital.name": "LCP",
    });
    expect(record.resource).toMatchObject({
      "deployment.environment.name": "test",
      "service.name": "clockwork-web",
      "service.version": "abc123",
    });
    expect(record.timeUnixNano).toBe("1722443200000000000");
  });

  it("rejects resource attribute injection", () => {
    const telemetry = new BrowserOpenTelemetry({
      exporter: { export: () => undefined },
      environment: "production\napi_key=secret",
      serviceVersion: "maya@example.com Bearer secret",
      randomValues: (target) => target.fill(1),
    });
    const record = telemetry.span("document.load", {
      "app.route": "/dashboard?email=maya@example.com#secret",
    });
    expect(record.resource).toMatchObject({
      "deployment.environment.name": "unknown",
      "service.version": "unknown",
    });
    expect(record.attributes).toEqual({ "app.route": "/dashboard" });
    expect(
      telemetry.span("api_key=sk_live_secret maya@example.com", {}).name,
    ).toBe("telemetry.redacted");
  });
});
