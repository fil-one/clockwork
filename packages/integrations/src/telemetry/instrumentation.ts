import { AsyncLocalStorage } from "node:async_hooks";

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
  private readonly context = new AsyncLocalStorage<{
    trace: TraceContext;
    correlation: TelemetryCorrelation;
  }>();

  public constructor(private readonly telemetry: ClockworkTelemetry) {}

  public trace<T>(input: {
    boundary: TelemetryBoundary;
    name: string;
    correlation: TelemetryCorrelation;
    attributes?: TelemetryAttributes;
    parent?: TraceContext;
    operation(): Promise<T>;
  }): Promise<T> {
    const inherited = this.context.getStore();
    const inheritedParent = input.parent ?? inherited?.trace;
    const correlation = {
      ...inherited?.correlation,
      ...input.correlation,
    };
    const span = this.telemetry.startSpan({
      boundary: input.boundary,
      name: input.name,
      correlation,
      ...(input.attributes ? { attributes: input.attributes } : {}),
      ...(inheritedParent ? { parent: inheritedParent } : {}),
    });
    return this.context.run(
      { trace: span.context(), correlation },
      async () => {
        try {
          const result = await input.operation();
          await endWithoutInterference(span, "ok");
          return result;
        } catch (error) {
          span.recordError(error);
          await endWithoutInterference(span, "error");
          throw error;
        }
      },
    );
  }

  public server = this.boundary("server");
  public api = this.boundary("api");
  public db = this.boundary("db");
  public workflow = this.boundary("workflow");
  public provider = this.boundary("provider");
  public webhook = this.boundary("webhook");
  public queue = this.boundary("queue");
  public outbox = this.boundary("outbox");

  public currentContext(): TraceContext | undefined {
    return this.context.getStore()?.trace;
  }

  public currentCorrelation(): TelemetryCorrelation | undefined {
    return this.context.getStore()?.correlation;
  }

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

async function endWithoutInterference(
  span: ReturnType<ClockworkTelemetry["startSpan"]>,
  status: "ok" | "error",
): Promise<void> {
  try {
    await span.end(status);
  } catch {
    // Export health is monitored separately and must not alter business results.
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
    private readonly providerName?: string,
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
      attributes: {
        "provider.operation": input.operation,
        ...(this.providerName ? { "provider.name": this.providerName } : {}),
      },
      ...(parent ? { parent } : {}),
      operation: () => this.inner.request(input),
    });
  }
}
