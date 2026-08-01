import { OtlpHttpTelemetrySink } from "@clockwork/integrations";
import { describe, expect, it } from "vitest";

import { resolveTelemetryRuntimeEnvironment } from "./runtime";

describe("telemetry runtime environment", () => {
  it("treats NODE_ENV production as production even when the public marker is absent or weaker", () => {
    expect(resolveTelemetryRuntimeEnvironment({ NODE_ENV: "production" })).toBe(
      "production",
    );
    expect(
      resolveTelemetryRuntimeEnvironment({
        NODE_ENV: "production",
        NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV: "test",
      }),
    ).toBe("production");
  });

  it("fails closed on insecure production OTLP when only NODE_ENV marks production", () => {
    const runtimeEnvironment = resolveTelemetryRuntimeEnvironment({
      NODE_ENV: "production",
    });
    expect(
      () =>
        new OtlpHttpTelemetrySink({
          environment: {
            OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.example.test:4318",
          },
          runtimeEnvironment,
        }),
    ).toThrow("OTEL_EXPORTER_OTLP_HTTPS_REQUIRED");
  });
});
