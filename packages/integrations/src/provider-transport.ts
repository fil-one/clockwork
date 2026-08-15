import type { ProviderResult } from "@clockwork/contracts";
import type { ZodType } from "zod";

import { isProviderRuntimeDeniedError } from "./runtime/provider-runtime";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_048_576;

/**
 * `cause` carries the original throw for an operator reading a stack; nothing
 * on this class other than `name` and `code` reaches telemetry
 * (`ClockworkTelemetry.recordError`) or a problem document
 * (`createApiApp`'s onError), so attaching it cannot widen either surface.
 */
export class ProviderTransportError extends Error {
  public constructor(
    public readonly kind: "transient" | "permanent",
    public readonly code: string,
    message: string,
    public readonly retryAfterMs?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProviderTransportError";
  }
}

export interface ProviderJsonTransport {
  request<T>(input: {
    operation: string;
    path: string;
    body: Readonly<Record<string, unknown>>;
    response: ZodType<T>;
    idempotencyKey?: string;
  }): Promise<T>;
}

export interface FetchJsonProviderTransportOptions {
  baseUrl: string;
  bearerToken: string;
  provider: string;
  timeoutMs?: number;
  allowInsecureLocalhost?: boolean;
  fetch?: typeof fetch;
}

function validIdempotencyKey(value: string): boolean {
  return value.length >= 8 && value.length <= 255 && !/[\r\n]/.test(value);
}

function safeProviderMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const message: unknown = "message" in value ? value.message : undefined;
  return typeof message === "string" && message.length <= 500
    ? message
    : fallback;
}

function safeProviderCode(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const code: unknown = "code" in value ? value.code : undefined;
  return typeof code === "string" && /^[A-Z0-9_.-]{2,100}$/.test(code)
    ? code
    : fallback;
}

/**
 * Small authenticated JSON boundary used by provider-specific adapters. Paths
 * are code-owned, redirects are forbidden, responses are bounded, and caller
 * data can never replace the configured origin.
 */
export class FetchJsonProviderTransport implements ProviderJsonTransport {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(
    private readonly options: FetchJsonProviderTransportOptions,
  ) {
    if (!options.provider.trim()) throw new Error("PROVIDER_NAME_REQUIRED");
    if (!options.bearerToken.trim() || /[\r\n]/.test(options.bearerToken))
      throw new Error("PROVIDER_CREDENTIAL_REQUIRED");
    const baseUrl = new URL(options.baseUrl);
    const local = ["127.0.0.1", "localhost", "::1"].includes(baseUrl.hostname);
    if (
      baseUrl.protocol !== "https:" &&
      !(
        baseUrl.protocol === "http:" &&
        options.allowInsecureLocalhost === true &&
        local
      )
    )
      throw new Error("PROVIDER_HTTPS_ENDPOINT_REQUIRED");
    if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash)
      throw new Error("PROVIDER_ENDPOINT_INVALID");
    this.baseUrl = baseUrl;
    // `fetch` accepts only its own global as the receiver. Calling it as a
    // property of this transport throws before the request is sent.
    this.fetcher = (options.fetch ?? fetch).bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 100 ||
      this.timeoutMs > 60_000
    )
      throw new Error("PROVIDER_TIMEOUT_INVALID");
  }

  public async request<T>(input: {
    operation: string;
    path: string;
    body: Readonly<Record<string, unknown>>;
    response: ZodType<T>;
    idempotencyKey?: string;
  }): Promise<T> {
    if (!/^\/[a-zA-Z0-9_./-]+$/.test(input.path) || input.path.includes(".."))
      throw new ProviderTransportError(
        "permanent",
        "PROVIDER_PATH_INVALID",
        "Provider path is invalid",
      );
    if (!input.operation.trim() || /[\r\n]/.test(input.operation))
      throw new ProviderTransportError(
        "permanent",
        "PROVIDER_OPERATION_INVALID",
        "Provider operation is invalid",
      );
    if (
      input.idempotencyKey !== undefined &&
      !validIdempotencyKey(input.idempotencyKey)
    )
      throw new ProviderTransportError(
        "permanent",
        "PROVIDER_IDEMPOTENCY_KEY_INVALID",
        "Provider idempotency key is invalid",
      );
    const endpoint = new URL(input.path.replace(/^\//, ""), this.baseUrl);
    if (endpoint.origin !== this.baseUrl.origin)
      throw new ProviderTransportError(
        "permanent",
        "PROVIDER_ORIGIN_CHANGED",
        "Provider path changed the configured origin",
      );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(endpoint, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.options.bearerToken}`,
          "content-type": "application/json",
          "user-agent": "clockwork-commerce/1",
          "x-clockwork-provider": this.options.provider,
          "x-clockwork-operation": input.operation,
          ...(input.idempotencyKey
            ? { "idempotency-key": input.idempotencyKey }
            : {}),
        },
        body: JSON.stringify(input.body),
      });
    } catch (cause) {
      const timeout = controller.signal.aborted;
      throw new ProviderTransportError(
        "transient",
        timeout ? "PROVIDER_TIMEOUT" : "PROVIDER_NETWORK_ERROR",
        timeout
          ? `${this.options.provider} request timed out`
          : `${this.options.provider} request failed`,
        undefined,
        { cause },
      );
    } finally {
      clearTimeout(timer);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES)
      throw new ProviderTransportError(
        "permanent",
        "PROVIDER_RESPONSE_TOO_LARGE",
        `${this.options.provider} response exceeded the maximum size`,
      );
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES)
      throw new ProviderTransportError(
        "permanent",
        "PROVIDER_RESPONSE_TOO_LARGE",
        `${this.options.provider} response exceeded the maximum size`,
      );
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (cause) {
      throw new ProviderTransportError(
        response.ok ? "permanent" : "transient",
        "PROVIDER_RESPONSE_INVALID",
        `${this.options.provider} returned invalid JSON`,
        undefined,
        { cause },
      );
    }
    if (!response.ok) {
      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      const transient = response.status === 429 || response.status >= 500;
      throw new ProviderTransportError(
        transient ? "transient" : "permanent",
        safeProviderCode(payload, `PROVIDER_HTTP_${response.status}`),
        safeProviderMessage(
          payload,
          `${this.options.provider} rejected the request`,
        ),
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
          ? retryAfterSeconds * 1_000
          : undefined,
      );
    }
    const parsed = input.response.safeParse(payload);
    if (!parsed.success)
      throw new ProviderTransportError(
        "permanent",
        "PROVIDER_RESPONSE_SCHEMA_INVALID",
        `${this.options.provider} returned an invalid response`,
        undefined,
        { cause: parsed.error },
      );
    return parsed.data;
  }
}

export function providerTransportFailure(
  error: unknown,
  fallbackCode: string,
): ProviderResult<never> {
  if (isProviderRuntimeDeniedError(error))
    return {
      ok: false,
      kind: "permanent",
      code: error.code,
      message: "Provider effect denied by persisted runtime policy",
    };
  if (error instanceof ProviderTransportError)
    return {
      ok: false,
      kind: error.kind,
      code: error.code,
      message: error.message,
      ...(error.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: error.retryAfterMs }),
    };
  return {
    ok: false,
    kind: "transient",
    code: fallbackCode,
    message: "Provider request failed",
  };
}
