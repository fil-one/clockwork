export type TelemetryAttribute = boolean | number | string;

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceFlags: "00" | "01";
}

export interface OpenTelemetryRecord {
  schemaUrl: "https://opentelemetry.io/schemas/1.30.0";
  resource: Readonly<Record<string, TelemetryAttribute>>;
  scope: { name: "@clockwork/web"; version: "1" };
  signal: "metric" | "span";
  name: string;
  timeUnixNano: string;
  trace: TraceContext;
  attributes: Readonly<Record<string, TelemetryAttribute>>;
  value?: number;
}

/** Vendor-neutral delivery boundary. OTLP, console, and test exporters can implement it. */
export interface BrowserTelemetryExporter {
  export(record: OpenTelemetryRecord): void | Promise<void>;
}

const ALLOWED_ATTRIBUTES = new Set([
  "app.route",
  "deployment.environment.name",
  "error.type",
  "navigation.type",
  "service.name",
  "service.version",
  "web_vital.name",
  "web_vital.rating",
]);

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER = /\b(?:bearer|basic)\s+[a-z0-9._~+/-]+=*/gi;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_SEGMENT = /^[A-Za-z0-9_-]{24,}$/;
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-(0[01])$/;
const STATIC_ROUTE_SEGMENTS = new Set([
  "access",
  "account",
  "accounts",
  "agreements",
  "amendments",
  "approvals",
  "assisted",
  "billing",
  "brand",
  "choose-organization",
  "collections",
  "commissions",
  "dashboard",
  "disputes",
  "execute",
  "gates",
  "internal",
  "marketplace",
  "mfa",
  "migrations",
  "new",
  "offboarding",
  "orders",
  "partner",
  "pocs",
  "portfolio",
  "price-books",
  "procurement",
  "provisioning",
  "queues",
  "quotes",
  "register",
  "registrations",
  "renewals",
  "reports",
  "sandboxes",
  "search",
  "services",
  "session-expired",
  "signing",
  "states",
  "support",
  "users",
]);
const SAFE_ERROR_TYPES = new Set([
  "AbortError",
  "AggregateError",
  "Error",
  "ErrorEvent",
  "EvalError",
  "InternalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
  "UnhandledRejection",
]);
const SAFE_ENVIRONMENTS = new Set([
  "demo",
  "development",
  "local",
  "production",
  "proof",
  "staging",
  "test",
  "unknown",
]);
const SAFE_RESOURCE_TOKEN = /^[A-Za-z0-9._-]{1,64}$/;
const SAFE_VITAL_NAMES = new Set(["CLS", "FCP", "INP", "LCP", "TTFB"]);
const SAFE_VITAL_RATINGS = new Set([
  "good",
  "needs-improvement",
  "poor",
  "unknown",
]);
const SAFE_NAVIGATION_TYPES = new Set([
  "back-forward",
  "back_forward",
  "navigate",
  "prerender",
  "reload",
  "restore",
  "unknown",
]);
const SAFE_SIGNAL_NAMES = new Set([
  "browser.error",
  "browser.unhandled_rejection",
  "document.load",
  "web_vital.cls",
  "web_vital.fcp",
  "web_vital.inp",
  "web_vital.lcp",
  "web_vital.ttfb",
]);

function nowUnixNano(now: () => number): string {
  return (BigInt(Math.trunc(now())) * 1_000_000n).toString();
}

function randomHex(bytes: number, randomValues: (target: Uint8Array) => void) {
  const buffer = new Uint8Array(bytes);
  randomValues(buffer);
  return [...buffer]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function parseTraceparent(
  value: string | undefined,
): TraceContext | null {
  if (!value) return null;
  const match = TRACEPARENT.exec(value.trim().toLowerCase());
  if (!match) return null;
  const [, traceId, spanId, traceFlags] = match;
  if (!traceId || !spanId || !traceFlags) return null;
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;
  return { traceId, spanId, traceFlags: traceFlags as "00" | "01" };
}

export function sanitizeRoute(value: string): string {
  let pathname = value;
  try {
    pathname = new URL(value, "https://telemetry.invalid").pathname;
  } catch {
    pathname = "/invalid-route";
  }
  return pathname
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      if (
        UUID.test(segment) ||
        OPAQUE_SEGMENT.test(segment) ||
        !STATIC_ROUTE_SEGMENTS.has(segment)
      )
        return ":id";
      return segment;
    })
    .join("/")
    .slice(0, 240);
}

export function redactTelemetryAttributes(
  attributes: Readonly<Record<string, unknown>>,
): Readonly<Record<string, TelemetryAttribute>> {
  const clean: Record<string, TelemetryAttribute> = {};
  for (const [key, raw] of Object.entries(attributes)) {
    if (!ALLOWED_ATTRIBUTES.has(key)) continue;
    if (
      typeof raw !== "string" &&
      typeof raw !== "number" &&
      typeof raw !== "boolean"
    )
      continue;
    if (typeof raw === "number" || typeof raw === "boolean") {
      clean[key] = raw;
      continue;
    }
    const value = (() => {
      if (key === "app.route") return sanitizeRoute(raw);
      if (key === "error.type")
        return SAFE_ERROR_TYPES.has(raw) ? raw : "RedactedError";
      if (key === "web_vital.name")
        return SAFE_VITAL_NAMES.has(raw) ? raw : "unknown";
      if (key === "web_vital.rating")
        return SAFE_VITAL_RATINGS.has(raw) ? raw : "unknown";
      if (key === "navigation.type")
        return SAFE_NAVIGATION_TYPES.has(raw) ? raw : "unknown";
      if (key === "deployment.environment.name")
        return SAFE_ENVIRONMENTS.has(raw) ? raw : "unknown";
      if (key === "service.name") return "clockwork-web";
      if (key === "service.version")
        return SAFE_RESOURCE_TOKEN.test(raw) ? raw : "unknown";
      return "[redacted]";
    })();
    clean[key] = value
      .replace(EMAIL, "[redacted]")
      .replace(BEARER, "[redacted]")
      .slice(0, 240);
  }
  return clean;
}

export class BrowserEventTelemetryExporter implements BrowserTelemetryExporter {
  export(record: OpenTelemetryRecord) {
    window.dispatchEvent(
      new CustomEvent<OpenTelemetryRecord>("clockwork:otel", {
        detail: record,
      }),
    );
  }
}

export interface BrowserTelemetryOptions {
  exporter?: BrowserTelemetryExporter;
  parentTraceparent?: string;
  environment?: string;
  serviceVersion?: string;
  now?: () => number;
  randomValues?: (target: Uint8Array) => void;
}

export class BrowserOpenTelemetry {
  private readonly exporter: BrowserTelemetryExporter;
  private readonly parent: TraceContext | null;
  private readonly environment: string;
  private readonly serviceVersion: string;
  private readonly now: () => number;
  private readonly randomValues: (target: Uint8Array) => void;

  constructor(options: BrowserTelemetryOptions = {}) {
    this.exporter = options.exporter ?? new BrowserEventTelemetryExporter();
    this.parent = parseTraceparent(options.parentTraceparent);
    this.environment = SAFE_ENVIRONMENTS.has(options.environment ?? "unknown")
      ? (options.environment ?? "unknown")
      : "unknown";
    this.serviceVersion = SAFE_RESOURCE_TOKEN.test(
      options.serviceVersion ?? "unknown",
    )
      ? (options.serviceVersion ?? "unknown")
      : "unknown";
    this.now = options.now ?? Date.now;
    this.randomValues =
      options.randomValues ??
      ((target) => globalThis.crypto.getRandomValues(target));
  }

  private trace(): TraceContext {
    return {
      traceId: this.parent?.traceId ?? randomHex(16, this.randomValues),
      spanId: randomHex(8, this.randomValues),
      ...(this.parent ? { parentSpanId: this.parent.spanId } : {}),
      traceFlags: this.parent?.traceFlags ?? "01",
    };
  }

  emit(
    signal: OpenTelemetryRecord["signal"],
    name: string,
    attributes: Readonly<Record<string, unknown>>,
    value?: number,
  ) {
    const record: OpenTelemetryRecord = {
      schemaUrl: "https://opentelemetry.io/schemas/1.30.0",
      resource: {
        "service.name": "clockwork-web",
        "service.version": this.serviceVersion,
        "deployment.environment.name": this.environment,
      },
      scope: { name: "@clockwork/web", version: "1" },
      signal,
      name: SAFE_SIGNAL_NAMES.has(name) ? name : "telemetry.redacted",
      timeUnixNano: nowUnixNano(this.now),
      trace: this.trace(),
      attributes: redactTelemetryAttributes(attributes),
      ...(value === undefined ? {} : { value }),
    };
    void this.exporter.export(record);
    return record;
  }

  span(name: string, attributes: Readonly<Record<string, unknown>>) {
    return this.emit("span", name, attributes);
  }

  metric(
    name: string,
    value: number,
    attributes: Readonly<Record<string, unknown>>,
  ) {
    return this.emit("metric", name, attributes, value);
  }
}
