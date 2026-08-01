import type { ZodType } from "zod";

import type { ProviderJsonTransport } from "../provider-transport";
import type {
  ClockworkTelemetry,
  TelemetryAttributes,
  TelemetryBoundary,
  TelemetryCorrelation,
  TraceContext,
} from "./telemetry";

export class RuntimeBoundaryInstrumentation {
  public constructor(private readonly telemetry: ClockworkTelemetry) {}

  public trace<T>(input: {
    boundary: TelemetryBoundary;
    name: string;
    correlation: TelemetryCorrelation;
    attributes?: TelemetryAttributes;
    parent?: TraceContext;
    operation(): Promise<T>;
  }): Promise<T> {
    return this.telemetry.withSpan({
      ...input,
      operation: () => input.operation(),
    });
  }

  public server = this.boundary("server");
  public api = this.boundary("api");
  public db = this.boundary("db");
  public workflow = this.boundary("workflow");
  public webhook = this.boundary("webhook");
  public queue = this.boundary("queue");
  public outbox = this.boundary("outbox");

  private boundary(boundary: TelemetryBoundary) {
    return <T>(input: {
      name: string;
      correlation: TelemetryCorrelation;
      attributes?: TelemetryAttributes;
      parent?: TraceContext;
      operation(): Promise<T>;
    }) => this.trace({ ...input, boundary });
  }
}

/** Adds provider spans without exposing bodies, headers, URLs, or credentials. */
export class TelemetryProviderJsonTransport implements ProviderJsonTransport {
  public constructor(
    private readonly inner: ProviderJsonTransport,
    private readonly telemetry: ClockworkTelemetry,
    private readonly correlation: (input: {
      operation: string;
      idempotencyKey?: string;
    }) => TelemetryCorrelation,
    private readonly parent?: () => TraceContext | undefined,
  ) {}

  public request<T>(input: {
    operation: string;
    path: string;
    body: Readonly<Record<string, unknown>>;
    response: ZodType<T>;
    idempotencyKey?: string;
  }): Promise<T> {
    const parent = this.parent?.();
    return this.telemetry.withSpan({
      boundary: "provider",
      name: `provider.${input.operation}`,
      correlation: this.correlation({
        operation: input.operation,
        ...(input.idempotencyKey
          ? { idempotencyKey: input.idempotencyKey }
          : {}),
      }),
      attributes: { "provider.operation": input.operation },
      ...(parent ? { parent } : {}),
      operation: () => this.inner.request(input),
    });
  }
}
