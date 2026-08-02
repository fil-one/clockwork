import type { TelemetrySink, TelemetrySpanRecord } from "./telemetry";
import { encodeOtlpTraceRequest } from "./otlp-protobuf";

export interface OtlpConfiguration {
  disabled: boolean;
  endpoint: string | null;
  protocol: "http/protobuf";
  serviceName: string;
  resourceAttributes: Readonly<Record<string, string>>;
  headerNames: readonly string[];
}

interface ResolvedOtlpConfiguration extends OtlpConfiguration {
  headers: Readonly<Record<string, string>>;
}

export function readOtlpConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
  runtimeEnvironment: "development" | "test" | "staging" | "production",
): OtlpConfiguration {
  return publicConfiguration(
    resolveOtlpConfiguration(environment, runtimeEnvironment),
  );
}

export class OtlpHttpTelemetrySink implements TelemetrySink {
  private readonly configuration: ResolvedOtlpConfiguration;

  public constructor(options: {
    environment: Readonly<Record<string, string | undefined>>;
    runtimeEnvironment: "development" | "test" | "staging" | "production";
    fetch?: typeof fetch;
    timeoutMs?: number;
    allowInsecureLocalhost?: boolean;
  }) {
    this.configuration = resolveOtlpConfiguration(
      options.environment,
      options.runtimeEnvironment,
      options.allowInsecureLocalhost ?? false,
    );
    // `fetch` accepts only its own global as the receiver. Calling it as a
    // property of this sink throws before the export is sent.
    this.fetcher = (options.fetch ?? fetch).bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (this.timeoutMs < 100 || this.timeoutMs > 30_000)
      throw new Error("OTEL_EXPORT_TIMEOUT_INVALID");
  }

  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  public async export(spans: readonly TelemetrySpanRecord[]): Promise<void> {
    if (this.configuration.disabled || spans.length === 0) return;
    if (!this.configuration.endpoint)
      throw new Error("OTEL_EXPORTER_OTLP_ENDPOINT_REQUIRED");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(this.configuration.endpoint, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          accept: "application/x-protobuf",
          "content-type": "application/x-protobuf",
          ...this.configuration.headers,
        },
        body: encodeOtlpTraceRequest(this.configuration, spans),
      });
      if (!response.ok)
        throw new Error(`OTEL_EXPORT_FAILED_${response.status}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function resolveOtlpConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
  runtimeEnvironment: "development" | "test" | "staging" | "production",
  allowInsecureLocalhost = false,
): ResolvedOtlpConfiguration {
  const disabled = environment.OTEL_SDK_DISABLED === "true";
  const protocol =
    environment.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ??
    environment.OTEL_EXPORTER_OTLP_PROTOCOL ??
    "http/protobuf";
  if (protocol !== "http/protobuf")
    throw new Error("OTEL_EXPORTER_OTLP_PROTOCOL_UNSUPPORTED");
  const signalEndpoint = environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  const genericEndpoint = environment.OTEL_EXPORTER_OTLP_ENDPOINT;
  const endpoint = signalEndpoint
    ? tracesEndpoint(signalEndpoint, false)
    : genericEndpoint
      ? tracesEndpoint(genericEndpoint, true)
      : null;
  if (
    endpoint &&
    runtimeEnvironment === "production" &&
    !endpoint.startsWith("https://") &&
    !(
      allowInsecureLocalhost &&
      endpoint.startsWith("http://") &&
      ["127.0.0.1", "localhost", "::1"].includes(new URL(endpoint).hostname)
    )
  )
    throw new Error("OTEL_EXPORTER_OTLP_HTTPS_REQUIRED");
  const headers = parsePairs(
    environment.OTEL_EXPORTER_OTLP_TRACES_HEADERS ??
      environment.OTEL_EXPORTER_OTLP_HEADERS,
  );
  return {
    disabled,
    endpoint,
    protocol,
    serviceName: environment.OTEL_SERVICE_NAME?.trim() || "clockwork-runtime",
    resourceAttributes: parseResourceAttributes(
      environment.OTEL_RESOURCE_ATTRIBUTES,
    ),
    headerNames: Object.keys(headers).sort(),
    headers,
  };
}

function publicConfiguration(
  input: ResolvedOtlpConfiguration,
): OtlpConfiguration {
  return {
    disabled: input.disabled,
    endpoint: input.endpoint,
    protocol: input.protocol,
    serviceName: input.serviceName,
    resourceAttributes: input.resourceAttributes,
    headerNames: input.headerNames,
  };
}

function tracesEndpoint(value: string, appendSignalPath: boolean): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash)
    throw new Error("OTEL_EXPORTER_OTLP_ENDPOINT_INVALID");
  if (appendSignalPath && !url.pathname.endsWith("/v1/traces"))
    url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/traces`;
  return url.toString();
}

function parsePairs(
  value: string | undefined,
): Readonly<Record<string, string>> {
  if (!value) return {};
  const result: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const separator = pair.indexOf("=");
    if (separator < 1) throw new Error("OTEL_CONFIGURATION_PAIR_INVALID");
    const key = decodeURIComponent(pair.slice(0, separator).trim());
    const item = decodeURIComponent(pair.slice(separator + 1).trim());
    if (!key || /[\r\n]/.test(key) || /[\r\n]/.test(item))
      throw new Error("OTEL_CONFIGURATION_PAIR_INVALID");
    result[key] = item;
  }
  return result;
}

function parseResourceAttributes(
  value: string | undefined,
): Readonly<Record<string, string>> {
  const allowed = new Set([
    "service.namespace",
    "service.version",
    "deployment.environment.name",
    "cloud.region",
    "cloud.availability_zone",
    "host.type",
  ]);
  return Object.fromEntries(
    Object.entries(parsePairs(value)).filter(
      ([key, item]) =>
        allowed.has(key) &&
        item.length <= 255 &&
        !/[@\r\n]|authorization|cookie|token|secret|password|email/i.test(item),
    ),
  );
}
