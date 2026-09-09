import { describe, expect, it, vi } from "vitest";

import { OtlpHttpTelemetrySink, readOtlpConfiguration } from "./otlp";
import type { TelemetrySpanRecord } from "./telemetry";

const span: TelemetrySpanRecord = {
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  spanId: "00f067aa0ba902b7",
  traceFlags: "01",
  name: "workflow.execute",
  boundary: "workflow",
  startTimeUnixNano: "1722441600000000000",
  endTimeUnixNano: "1722441601000000000",
  status: "ok",
  attributes: { "clockwork.request.id": "request-1" },
};

describe("OTLP HTTP telemetry", () => {
  it("does not require HTTPS for an explicitly disabled platform exporter", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const sink = new OtlpHttpTelemetrySink({
      environment: {
        OTEL_SDK_DISABLED: "true",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.internal:4318",
      },
      runtimeEnvironment: "production",
      fetch: fetcher,
    });
    await sink.export([span]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses standard vendor-neutral OTLP variables and hides header values from public config", () => {
    const config = readOtlpConfiguration(
      {
        OTEL_SERVICE_NAME: "clockwork-worker",
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.test/collector",
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
        OTEL_EXPORTER_OTLP_HEADERS:
          "authorization=Bearer%20not-visible,x-tenant=runtime",
        OTEL_RESOURCE_ATTRIBUTES:
          "deployment.environment.name=staging,service.namespace=clockwork",
      },
      "staging",
    );
    expect(config).toMatchObject({
      endpoint: "https://otel.example.test/collector/v1/traces",
      protocol: "http/protobuf",
      serviceName: "clockwork-worker",
      headerNames: ["authorization", "x-tenant"],
    });
    expect(JSON.stringify(config)).not.toContain("not-visible");
  });

  it("exports OTLP protobuf without binding to a hosted backend", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const sink = new OtlpHttpTelemetrySink({
      environment: {
        OTEL_SERVICE_NAME: "clockwork-worker",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
          "https://collector.example.test/v1/traces",
      },
      runtimeEnvironment: "production",
      fetch: fetcher,
    });
    await sink.export([span]);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://collector.example.test/v1/traces");
    expect(new Headers(init?.headers).get("content-type")).toBe(
      "application/x-protobuf",
    );
    expect(init?.body).toBeInstanceOf(ArrayBuffer);
    expect((init?.body as ArrayBuffer).byteLength).toBeGreaterThan(100);
  });

  it("calls the injected fetch with the global receiver", async () => {
    const receivers: unknown[] = [];
    const fetcher: typeof fetch = function (this: unknown) {
      receivers.push(this);
      if (this !== undefined && this !== globalThis)
        throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response(null, { status: 200 }));
    };
    const sink = new OtlpHttpTelemetrySink({
      environment: {
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
          "https://collector.example.test/v1/traces",
      },
      runtimeEnvironment: "production",
      fetch: fetcher,
    });

    await expect(sink.export([span])).resolves.toBeUndefined();
    expect(receivers).toEqual([globalThis]);
  });

  it("uses a signal-specific traces endpoint verbatim as required by OTLP", () => {
    expect(
      readOtlpConfiguration(
        {
          OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
            "https://collector.example.test/custom-traces",
        },
        "staging",
      ).endpoint,
    ).toBe("https://collector.example.test/custom-traces");
  });

  it("requires TLS for production and rejects unsupported protocols", () => {
    expect(() =>
      readOtlpConfiguration(
        { OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.example/v1/traces" },
        "production",
      ),
    ).toThrow("OTEL_EXPORTER_OTLP_HTTPS_REQUIRED");
    expect(() =>
      readOtlpConfiguration({ OTEL_EXPORTER_OTLP_PROTOCOL: "grpc" }, "test"),
    ).toThrow("OTEL_EXPORTER_OTLP_PROTOCOL_UNSUPPORTED");
  });

  it("allows insecure production OTLP only for an explicit loopback release proof", () => {
    expect(
      () =>
        new OtlpHttpTelemetrySink({
          environment: {
            OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:34000",
          },
          runtimeEnvironment: "production",
          allowInsecureLocalhost: true,
        }),
    ).not.toThrow();
    expect(
      () =>
        new OtlpHttpTelemetrySink({
          environment: {
            OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.example.test",
          },
          runtimeEnvironment: "production",
          allowInsecureLocalhost: true,
        }),
    ).toThrow("OTEL_EXPORTER_OTLP_HTTPS_REQUIRED");
  });
});
