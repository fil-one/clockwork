export const telemetryBoundaries = [
  "browser",
  "server",
  "api",
  "db",
  "workflow",
  "provider",
  "webhook",
  "queue",
  "outbox",
] as const;

export type TelemetryBoundary = (typeof telemetryBoundaries)[number];

export interface TelemetryCorrelation {
  requestId?: string;
  workflowId?: string;
  taskId?: string;
  auditId?: string;
  outboxId?: string;
}

export interface TelemetryAttributes {
  "clockwork.operation"?: string;
  "clockwork.outcome"?: "ok" | "error" | "duplicate" | "denied";
  "clockwork.synthetic"?: boolean;
  "error.type"?: string;
  "error.code"?: string;
  "http.request.method"?: string;
  "http.response.status_code"?: number;
  "http.route"?: string;
  "db.operation.name"?: string;
  "db.system.name"?: string;
  "messaging.destination.name"?: string;
  "messaging.operation.name"?: string;
  "provider.name"?: string;
  "provider.operation"?: string;
  "webhook.provider"?: string;
  "workflow.name"?: string;
  "workflow.attempt"?: number;
  "queue.age_ms"?: number;
  "outbox.age_ms"?: number;
}

export interface TelemetrySpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceFlags: "00" | "01";
  name: string;
  boundary: TelemetryBoundary;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  status: "ok" | "error";
  attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface TelemetrySink {
  export(spans: readonly TelemetrySpanRecord[]): Promise<void>;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  traceFlags: "00" | "01";
}

const allowedAttributeKeys = new Set<keyof TelemetryAttributes>([
  "clockwork.operation",
  "clockwork.outcome",
  "clockwork.synthetic",
  "error.type",
  "error.code",
  "http.request.method",
  "http.response.status_code",
  "http.route",
  "db.operation.name",
  "db.system.name",
  "messaging.destination.name",
  "messaging.operation.name",
  "provider.name",
  "provider.operation",
  "webhook.provider",
  "workflow.name",
  "workflow.attempt",
  "queue.age_ms",
  "outbox.age_ms",
]);

const correlationKeys: Record<keyof TelemetryCorrelation, string> = {
  requestId: "clockwork.request.id",
  workflowId: "clockwork.workflow.id",
  taskId: "clockwork.task.id",
  auditId: "clockwork.audit.id",
  outboxId: "clockwork.outbox.id",
};

export class ClockworkTelemetry {
  public constructor(
    private readonly sink: TelemetrySink,
    private readonly now: () => number = () => Date.now(),
  ) {}

  public startSpan(input: {
    boundary: TelemetryBoundary;
    name: string;
    correlation?: TelemetryCorrelation;
    attributes?: TelemetryAttributes;
    parent?: TraceContext;
  }): ClockworkSpan {
    const trace = input.parent ?? {
      traceId: randomHex(32),
      spanId: randomHex(16),
      traceFlags: "01" as const,
    };
    return new ClockworkSpan({
      sink: this.sink,
      now: this.now,
      boundary: input.boundary,
      name: safeName(input.name),
      traceId: trace.traceId,
      spanId: randomHex(16),
      ...(input.parent ? { parentSpanId: trace.spanId } : {}),
      traceFlags: trace.traceFlags,
      attributes: safeAttributes(input.correlation, input.attributes),
    });
  }

  public async withSpan<T>(input: {
    boundary: TelemetryBoundary;
    name: string;
    correlation?: TelemetryCorrelation;
    attributes?: TelemetryAttributes;
    parent?: TraceContext;
    operation(span: ClockworkSpan): Promise<T>;
  }): Promise<T> {
    const span = this.startSpan(input);
    try {
      const result = await input.operation(span);
      await endWithoutInterference(span, "ok");
      return result;
    } catch (error) {
      span.recordError(error);
      await endWithoutInterference(span, "error");
      throw error;
    }
  }

  public syntheticFailure(input: {
    boundary: TelemetryBoundary;
    scenario:
      | "auth_anomaly"
      | "db_pitr"
      | "queue_age"
      | "dead_letter"
      | "outbox_backlog"
      | "provisioning"
      | "reconciliation"
      | "unhandled_error";
    correlation: TelemetryCorrelation;
  }): Promise<void> {
    const span = this.startSpan({
      boundary: input.boundary,
      name: `synthetic.${input.scenario}`,
      correlation: input.correlation,
      attributes: {
        "clockwork.synthetic": true,
        "clockwork.outcome": "error",
        "error.type": "SyntheticOperationalFailure",
        "error.code": input.scenario.toUpperCase(),
      },
    });
    return span.end("error");
  }
}

async function endWithoutInterference(
  span: ClockworkSpan,
  status: "ok" | "error",
): Promise<void> {
  try {
    await span.end(status);
  } catch {
    // A telemetry backend outage must not change application control flow.
  }
}

export class ClockworkSpan {
  private ended = false;
  private readonly startedAt: number;
  private readonly attributes: Record<string, string | number | boolean>;

  public constructor(
    private readonly input: {
      sink: TelemetrySink;
      now: () => number;
      boundary: TelemetryBoundary;
      name: string;
      traceId: string;
      spanId: string;
      parentSpanId?: string;
      traceFlags: "00" | "01";
      attributes: Record<string, string | number | boolean>;
    },
  ) {
    this.startedAt = input.now();
    this.attributes = { ...input.attributes };
  }

  public context(): TraceContext {
    return {
      traceId: this.input.traceId,
      spanId: this.input.spanId,
      traceFlags: this.input.traceFlags,
    };
  }

  public setAttributes(attributes: TelemetryAttributes): void {
    Object.assign(this.attributes, safeAttributes(undefined, attributes));
  }

  public recordError(error: unknown): void {
    this.attributes["error.type"] =
      error instanceof Error ? safeName(error.name) : "UnknownError";
    const code = safeErrorCode(error);
    if (code) this.attributes["error.code"] = code;
    this.attributes["clockwork.outcome"] = "error";
  }

  public async end(status: "ok" | "error"): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    const endedAt = this.input.now();
    await this.input.sink.export([
      {
        traceId: this.input.traceId,
        spanId: this.input.spanId,
        ...(this.input.parentSpanId
          ? { parentSpanId: this.input.parentSpanId }
          : {}),
        traceFlags: this.input.traceFlags,
        name: this.input.name,
        boundary: this.input.boundary,
        startTimeUnixNano: millisecondsToUnixNano(this.startedAt),
        endTimeUnixNano: millisecondsToUnixNano(endedAt),
        status,
        attributes: { ...this.attributes },
      },
    ]);
  }
}

export class InMemoryTelemetrySink implements TelemetrySink {
  public readonly spans: TelemetrySpanRecord[] = [];

  public export(spans: readonly TelemetrySpanRecord[]): Promise<void> {
    this.spans.push(...spans.map((span) => structuredClone(span)));
    return Promise.resolve();
  }
}

export function parseTraceparent(
  value: string | null,
): TraceContext | undefined {
  if (!value) return undefined;
  const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-(00|01)$/.exec(value);
  if (!match || /^0+$/.test(match[1] ?? "") || /^0+$/.test(match[2] ?? ""))
    return undefined;
  return {
    traceId: match[1] ?? "",
    spanId: match[2] ?? "",
    traceFlags: (match[3] ?? "00") as "00" | "01",
  };
}

export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.traceFlags}`;
}

function safeAttributes(
  correlation?: TelemetryCorrelation,
  attributes?: TelemetryAttributes,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  if (correlation) {
    for (const [key, outputKey] of Object.entries(correlationKeys)) {
      const value = correlation[key as keyof TelemetryCorrelation];
      if (value !== undefined) result[outputKey] = safeIdentifier(value);
    }
  }
  if (attributes) {
    for (const key of allowedAttributeKeys) {
      const value: string | number | boolean | undefined = attributes[key];
      if (value === undefined) continue;
      result[key] = typeof value === "string" ? safeName(value) : value;
    }
  }
  return result;
}

function safeIdentifier(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,254}$/.test(value))
    throw new Error("TELEMETRY_CORRELATION_ID_INVALID");
  return value;
}

function safeName(value: string): string {
  const normalized = value.trim().slice(0, 255);
  if (
    !normalized ||
    /[\r\n]/.test(normalized) ||
    /[@?&#]|:\/\//.test(normalized) ||
    /authorization|cookie|token|secret|password|email|raw[_ .-]?body|query/i.test(
      normalized,
    )
  )
    return "redacted";
  return normalized;
}

function safeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return;
  const code: unknown = error.code;
  return typeof code === "string" && /^[A-Z0-9_.-]{2,100}$/.test(code)
    ? code
    : undefined;
}

function randomHex(length: 16 | 32): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, length);
}

function millisecondsToUnixNano(value: number): string {
  return (BigInt(Math.trunc(value)) * 1_000_000n).toString();
}
