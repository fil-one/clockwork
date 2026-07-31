import { createHash } from "node:crypto";

import type { Money, ProviderResult } from "@clockwork/contracts";

export interface ProviderErrorLike {
  readonly code?: string;
  readonly message?: string;
  readonly statusCode?: number;
  readonly type?: string;
  readonly headers?: Record<string, string | undefined>;
}

export function stableExternalId(prefix: string, value: unknown): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24);
  return `${prefix}_${digest}`;
}

export function derivedIdempotencyKey(base: string, operation: string): string {
  const suffix = createHash("sha256")
    .update(operation)
    .digest("hex")
    .slice(0, 16);
  const available = 255 - suffix.length - 1;
  return `${base.slice(0, available)}:${suffix}`;
}

export function toProviderFailure(
  error: unknown,
): Exclude<ProviderResult<never>, { ok: true }> {
  const candidate = isRecord(error) ? (error as ProviderErrorLike) : undefined;
  const statusCode = candidate?.statusCode;
  const type = candidate?.type ?? "";
  const transient =
    statusCode === 408 ||
    statusCode === 409 ||
    statusCode === 425 ||
    statusCode === 429 ||
    (statusCode !== undefined && statusCode >= 500) ||
    [
      "StripeAPIError",
      "StripeConnectionError",
      "StripeRateLimitError",
      "AbortError",
      "TimeoutError",
    ].includes(type);
  const retryAfter = candidate?.headers?.["retry-after"];
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : undefined;
  const retryAfterMs =
    retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds)
      ? Math.max(0, Math.round(retryAfterSeconds * 1000))
      : undefined;
  return {
    ok: false,
    kind: transient ? "transient" : "permanent",
    code:
      candidate?.code ??
      (statusCode === undefined
        ? "PROVIDER_ERROR"
        : `PROVIDER_HTTP_${statusCode}`),
    message: candidate?.message ?? "The provider operation failed",
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

export function toSafeMinorUnits(money: Money): number {
  const minor = BigInt(money.minor);
  if (
    minor > BigInt(Number.MAX_SAFE_INTEGER) ||
    minor < BigInt(Number.MIN_SAFE_INTEGER)
  )
    throw new RangeError(
      `Amount ${money.minor} ${money.currency} exceeds provider integer precision`,
    );
  return Number(minor);
}

export function parseProviderMinorUnits(value: number): string {
  if (!Number.isSafeInteger(value))
    throw new RangeError(
      `Provider returned unsafe minor-unit amount ${String(value)}`,
    );
  return String(value);
}

export function epochSeconds(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds))
    throw new TypeError(`Invalid instant: ${value}`);
  return Math.floor(milliseconds / 1000);
}

export function isoFromEpoch(value: number): string {
  if (!Number.isSafeInteger(value))
    throw new TypeError(`Invalid provider epoch: ${String(value)}`);
  return new Date(value * 1000).toISOString();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requiredString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError(`Provider payload is missing ${key}`);
  return value;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
