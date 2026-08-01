import {
  ClockworkTelemetry,
  OtlpHttpTelemetrySink,
  RuntimeBoundaryInstrumentation,
  TelemetryProviderJsonTransport,
} from "@clockwork/integrations/telemetry";
import type { ProviderJsonTransport } from "@clockwork/integrations/provider-transport";

export function resolveTelemetryRuntimeEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): "development" | "test" | "staging" | "production" {
  if (environment.NODE_ENV === "production") return "production";
  const value = environment.NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV;
  if (value === "test" || value === "staging" || value === "production")
    return value;
  if (environment.NODE_ENV === "test") return "test";
  return "development";
}

const runtimeEnvironment = resolveTelemetryRuntimeEnvironment(process.env);

const telemetryEnvironment = {
  ...process.env,
  ...(!process.env.OTEL_EXPORTER_OTLP_ENDPOINT &&
  !process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
    ? { OTEL_SDK_DISABLED: "true" }
    : {}),
};

export const runtimeTelemetrySink = new OtlpHttpTelemetrySink({
  environment: telemetryEnvironment,
  runtimeEnvironment,
  allowInsecureLocalhost:
    runtimeEnvironment === "production" &&
    process.env.NODE_ENV === "production" &&
    process.env.CLOCKWORK_RELEASE_PROOF === "1",
});

export const runtimeTelemetry = new ClockworkTelemetry(runtimeTelemetrySink);

export const runtimeBoundaryInstrumentation =
  new RuntimeBoundaryInstrumentation(runtimeTelemetry);

export const databaseTransactionTelemetry = {
  trace<T>(input: {
    kind: "authorized" | "internal";
    requestId: string;
    operation(): Promise<T>;
  }): Promise<T> {
    return runtimeBoundaryInstrumentation.db({
      name: `db.${input.kind}_transaction`,
      correlation: { requestId: input.requestId },
      attributes: {
        "clockwork.operation": `db.${input.kind}_transaction`,
        "db.operation.name": input.kind,
        "db.system.name": "postgresql",
      },
      operation: () => input.operation(),
    });
  },
};

export function instrumentProviderTransport(
  provider: string,
  inner: ProviderJsonTransport,
): ProviderJsonTransport {
  return new TelemetryProviderJsonTransport(
    inner,
    runtimeTelemetry,
    () => runtimeBoundaryInstrumentation.currentCorrelation() ?? {},
    () => runtimeBoundaryInstrumentation.currentContext(),
    provider,
  );
}
