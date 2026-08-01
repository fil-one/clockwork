import { createHmac, timingSafeEqual } from "node:crypto";

import {
  ids,
  type AccountId,
  type WebhookVerificationResult,
  type WebhookVerifier,
} from "@clockwork/contracts";

const PROVIDER_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$/;
const CATEGORY_PATTERN = /^[a-z][a-z0-9._-]{0,79}$/;
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;
const UTC_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

export type SupportWebhookEventType =
  | "support.signal.created"
  | "support.signal.updated"
  | "support.signal.resolved";

export interface SupportWebhookBinding {
  readonly provider: string;
  readonly externalAccountId: string;
  readonly accountId: AccountId;
}

/** Immutable provider-account mapping resolved before safe metadata is emitted. */
export interface SupportWebhookBindingStore {
  save(binding: SupportWebhookBinding): Promise<void>;
  find(input: {
    provider: string;
    externalAccountId: string;
  }): Promise<SupportWebhookBinding | undefined>;
}

/** Deterministic test/local store. Production wiring must use durable bindings. */
export class InMemorySupportWebhookBindingStore implements SupportWebhookBindingStore {
  private readonly bindings = new Map<string, SupportWebhookBinding>();

  public constructor(bindings: readonly SupportWebhookBinding[] = []) {
    for (const binding of bindings) this.store(binding);
  }

  public save(binding: SupportWebhookBinding): Promise<void> {
    try {
      this.store(binding);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new Error("Support webhook binding failure"),
      );
    }
  }

  public find(input: {
    provider: string;
    externalAccountId: string;
  }): Promise<SupportWebhookBinding | undefined> {
    const provider = providerId(input.provider);
    const externalAccountId = externalId(
      input.externalAccountId,
      "external account ID",
    );
    const binding = this.bindings.get(bindingKey(provider, externalAccountId));
    return Promise.resolve(binding ? { ...binding } : undefined);
  }

  private store(binding: SupportWebhookBinding): void {
    const normalized: SupportWebhookBinding = {
      provider: providerId(binding.provider),
      externalAccountId: externalId(
        binding.externalAccountId,
        "external account ID",
      ),
      accountId: ids.account.parse(binding.accountId),
    };
    const key = bindingKey(normalized.provider, normalized.externalAccountId);
    const existing = this.bindings.get(key);
    if (existing && existing.accountId !== normalized.accountId)
      throw new Error("Support webhook binding conflict");
    if (!existing) this.bindings.set(key, Object.freeze(normalized));
  }
}

export interface VerifiedSupportWebhookEvent {
  readonly type: SupportWebhookEventType;
  readonly eventId: string;
  readonly provider: string;
  readonly accountId: AccountId;
  readonly externalSignalId: string;
  readonly sequence: number;
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly category: string;
  readonly status: "open" | "pending" | "resolved";
  readonly occurredAt: string;
}

interface ProviderSupportWebhookEvent {
  type: SupportWebhookEventType;
  eventId: string;
  provider: string;
  externalAccountId: string;
  externalSignalId: string;
  sequence: number;
  severity: VerifiedSupportWebhookEvent["severity"];
  category: string;
  status: VerifiedSupportWebhookEvent["status"];
  occurredAt: string;
}

/**
 * Verifies a configured support provider and emits only account-bound metadata.
 * Provider text, message bodies, requester details, and other PII are discarded.
 */
export class SupportWebhookVerifier implements WebhookVerifier<VerifiedSupportWebhookEvent> {
  private readonly provider: string;

  public constructor(
    provider: string,
    private readonly secret: string,
    private readonly bindingStore: Pick<SupportWebhookBindingStore, "find">,
    private readonly nowEpochSeconds: () => number = () =>
      Math.floor(Date.now() / 1_000),
  ) {
    this.provider = providerId(provider);
    if (secret.length < 16)
      throw new Error("Support webhook secret must be at least 16 characters");
  }

  public async verify(input: {
    rawBody: Uint8Array;
    signature: string;
    toleranceSeconds?: number;
  }): Promise<WebhookVerificationResult<VerifiedSupportWebhookEvent>> {
    const signature = parseSignatureHeader(input.signature);
    const toleranceSeconds = input.toleranceSeconds ?? 300;
    if (!Number.isSafeInteger(toleranceSeconds) || toleranceSeconds < 0)
      throw new Error(
        "Support webhook tolerance must be a non-negative integer",
      );
    if (
      Math.abs(this.nowEpochSeconds() - signature.timestamp) > toleranceSeconds
    )
      throw new Error("Support webhook timestamp is outside tolerance");
    const expected = createHmac("sha256", this.secret)
      .update(signedBytes(signature.timestamp, input.rawBody))
      .digest("hex");
    if (!safeEqual(expected, signature.digest))
      throw new Error("Invalid support webhook signature");

    const providerEvent = parseProviderEvent(input.rawBody);
    if (providerEvent.provider !== this.provider)
      throw new Error("Support webhook provider binding mismatch");
    const binding = await this.bindingStore.find({
      provider: this.provider,
      externalAccountId: providerEvent.externalAccountId,
    });
    if (!binding) throw new Error("Support webhook account is not bound");
    if (
      binding.provider !== this.provider ||
      binding.externalAccountId !== providerEvent.externalAccountId
    )
      throw new Error("Support webhook account binding mismatch");

    const payload: VerifiedSupportWebhookEvent = {
      type: providerEvent.type,
      eventId: providerEvent.eventId,
      provider: this.provider,
      accountId: ids.account.parse(binding.accountId),
      externalSignalId: providerEvent.externalSignalId,
      sequence: providerEvent.sequence,
      severity: providerEvent.severity,
      category: providerEvent.category,
      status: providerEvent.status,
      occurredAt: providerEvent.occurredAt,
    };
    return {
      eventId: payload.eventId,
      occurredAt: payload.occurredAt,
      payload,
    };
  }
}

export function signFakeSupportWebhook(input: {
  secret: string;
  timestamp: number;
  rawBody: Uint8Array;
}): string {
  if (!Number.isSafeInteger(input.timestamp) || input.timestamp < 0)
    throw new Error("Support webhook signature timestamp is invalid");
  const digest = createHmac("sha256", input.secret)
    .update(signedBytes(input.timestamp, input.rawBody))
    .digest("hex");
  return `t=${input.timestamp},v1=${digest}`;
}

function parseProviderEvent(rawBody: Uint8Array): ProviderSupportWebhookEvent {
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(rawBody),
    );
  } catch {
    throw new Error("Malformed support webhook event");
  }
  if (!isRecord(value)) throw new Error("Malformed support webhook event");
  const type = oneOf(value.type, "event type", [
    "support.signal.created",
    "support.signal.updated",
    "support.signal.resolved",
  ] as const);
  const severity = oneOf(value.severity, "severity", [
    "low",
    "medium",
    "high",
    "critical",
  ] as const);
  const status = oneOf(value.status, "status", [
    "open",
    "pending",
    "resolved",
  ] as const);
  if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1)
    throw new Error("Support webhook sequence must be a positive safe integer");
  const occurredAt = instant(value.occurredAt);
  return {
    type,
    eventId: externalId(value.eventId, "event ID"),
    provider: providerId(value.provider),
    externalAccountId: externalId(
      value.externalAccountId,
      "external account ID",
    ),
    externalSignalId: externalId(value.externalSignalId, "external signal ID"),
    sequence: Number(value.sequence),
    severity,
    category: category(value.category),
    status,
    occurredAt,
  };
}

function parseSignatureHeader(value: string): {
  timestamp: number;
  digest: string;
} {
  const components = value.split(",");
  if (components.length !== 2)
    throw new Error("Malformed support webhook signature header");
  const parsed = new Map<string, string>();
  for (const component of components) {
    const separator = component.indexOf("=");
    if (separator < 1)
      throw new Error("Malformed support webhook signature header");
    const key = component.slice(0, separator).trim();
    const componentValue = component.slice(separator + 1).trim();
    if ((key !== "t" && key !== "v1") || parsed.has(key) || !componentValue)
      throw new Error("Malformed support webhook signature header");
    parsed.set(key, componentValue);
  }
  const timestampText = parsed.get("t");
  const digest = parsed.get("v1");
  if (
    !timestampText ||
    !/^\d{1,12}$/.test(timestampText) ||
    !digest ||
    !SIGNATURE_PATTERN.test(digest)
  )
    throw new Error("Malformed support webhook signature header");
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp))
    throw new Error("Malformed support webhook signature header");
  return { timestamp, digest };
}

function signedBytes(timestamp: number, rawBody: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const signed = new Uint8Array(prefix.length + rawBody.length);
  signed.set(prefix);
  signed.set(rawBody, prefix.length);
  return signed;
}

function safeEqual(expected: string, actual: string): boolean {
  if (!SIGNATURE_PATTERN.test(actual)) return false;
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(actual, "hex"),
  );
}

function providerId(value: unknown): string {
  if (typeof value !== "string" || !PROVIDER_PATTERN.test(value))
    throw new Error("Support webhook provider identifier is invalid");
  return value;
}

function externalId(value: unknown, label: string): string {
  if (typeof value !== "string" || !EXTERNAL_ID_PATTERN.test(value))
    throw new Error(`Support webhook ${label} is invalid`);
  return value;
}

function category(value: unknown): string {
  if (typeof value !== "string" || !CATEGORY_PATTERN.test(value))
    throw new Error("Support webhook category is invalid");
  return value;
}

function instant(value: unknown): string {
  if (typeof value !== "string" || !UTC_INSTANT_PATTERN.test(value))
    throw new Error("Support webhook occurredAt must be a UTC instant");
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds))
    throw new Error("Support webhook occurredAt must be a UTC instant");
  return new Date(milliseconds).toISOString();
}

function oneOf<const Values extends readonly string[]>(
  value: unknown,
  label: string,
  values: Values,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value))
    throw new Error(`Support webhook ${label} is invalid`);
  return value;
}

function bindingKey(provider: string, externalAccountId: string): string {
  return `${provider}\u0000${externalAccountId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
