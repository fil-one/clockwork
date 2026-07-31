import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type {
  AccountId,
  DocumentId,
  IdempotencyKey,
  ProviderResult,
  WebhookVerificationResult,
  WebhookVerifier,
} from "@clockwork/contracts";

export type SigningMode = "redirect" | "embedded";
export type EnvelopeState =
  "created" | "sent" | "viewed" | "completed" | "declined" | "voided";

export interface EsignCapabilities {
  redirect: boolean;
  embedded: boolean;
  countersignature: boolean;
}

export interface EnvelopeSigner {
  email: string;
  name: string;
  role: "customer" | "fil_one";
  order: number;
  authorityTitle?: string;
  authorityAttestation?: string;
}

export interface EnvelopeRecord {
  /** Commerce-owned envelope identifier. */
  envelopeId: string;
  /** Provider-owned identifier used only at the provider boundary. */
  providerEnvelopeId: string;
  accountId: AccountId;
  documentId: DocumentId;
  state: EnvelopeState;
  signingMode: SigningMode;
  signingUrl: string;
  signers: readonly EnvelopeSigner[];
  createdAt: string;
}

export interface CompletedEnvelopeEvidence {
  envelopeId: string;
  signedPdf: Uint8Array;
  certificate: Uint8Array;
  signedPdfSha256: string;
  certificateSha256: string;
  completedAt: string;
}

export interface EsignPort {
  capabilities(): Promise<EsignCapabilities>;
  createEnvelope(input: {
    envelopeId: string;
    accountId: AccountId;
    documentId: DocumentId;
    documentBytes: Uint8Array;
    documentSha256: string;
    signers: readonly EnvelopeSigner[];
    preferredMode: SigningMode;
    redirectUrl: string;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<EnvelopeRecord>>;
  getEnvelope(envelopeId: string): Promise<ProviderResult<EnvelopeRecord>>;
  retrieveCompletedEvidence(
    envelopeId: string,
  ): Promise<ProviderResult<CompletedEnvelopeEvidence>>;
  voidEnvelope(input: {
    envelopeId: string;
    reason: string;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ envelopeId: string; state: "voided" }>>;
}

/**
 * Durable provider-to-commerce envelope binding. Production implementations
 * must atomically preserve envelopeId/providerEnvelopeId as immutable unique
 * keys. Saving a later provider state may update the record but must never
 * rebind either identity.
 */
export interface EsignEnvelopeStore {
  save(record: EnvelopeRecord): Promise<void>;
  findByEnvelopeId(envelopeId: string): Promise<EnvelopeRecord | undefined>;
  findByProviderEnvelopeId(
    providerEnvelopeId: string,
  ): Promise<EnvelopeRecord | undefined>;
}

/** Deterministic test helper. Production wiring must inject durable storage. */
export class InMemoryEsignEnvelopeStore implements EsignEnvelopeStore {
  private readonly byEnvelopeId = new Map<string, EnvelopeRecord>();
  private readonly internalIdByProviderId = new Map<string, string>();

  public save(record: EnvelopeRecord): Promise<void> {
    const current = this.byEnvelopeId.get(record.envelopeId);
    if (
      current &&
      (current.providerEnvelopeId !== record.providerEnvelopeId ||
        current.accountId !== record.accountId ||
        current.documentId !== record.documentId)
    )
      return Promise.reject(new Error("E-sign envelope binding conflict"));
    const internalId = this.internalIdByProviderId.get(
      record.providerEnvelopeId,
    );
    if (internalId && internalId !== record.envelopeId)
      return Promise.reject(new Error("E-sign provider envelope is rebound"));
    this.byEnvelopeId.set(record.envelopeId, cloneEnvelope(record));
    this.internalIdByProviderId.set(
      record.providerEnvelopeId,
      record.envelopeId,
    );
    return Promise.resolve();
  }

  public findByEnvelopeId(
    envelopeId: string,
  ): Promise<EnvelopeRecord | undefined> {
    const record = this.byEnvelopeId.get(envelopeId);
    return Promise.resolve(record ? cloneEnvelope(record) : undefined);
  }

  public findByProviderEnvelopeId(
    providerEnvelopeId: string,
  ): Promise<EnvelopeRecord | undefined> {
    const envelopeId = this.internalIdByProviderId.get(providerEnvelopeId);
    const record = envelopeId ? this.byEnvelopeId.get(envelopeId) : undefined;
    return Promise.resolve(record ? cloneEnvelope(record) : undefined);
  }
}

export interface EsignProviderClient {
  capabilities(): Promise<EsignCapabilities>;
  createEnvelope(input: {
    documentBytes: Uint8Array;
    signers: readonly EnvelopeSigner[];
    mode: SigningMode;
    redirectUrl: string;
    externalReference: string;
    idempotencyKey: string;
  }): Promise<{ id: string; state: EnvelopeState; signingUrl: string }>;
  getEnvelope(id: string): Promise<{
    id: string;
    state: EnvelopeState;
    signingUrl: string;
    createdAt: string;
  }>;
  downloadSignedPdf(id: string): Promise<Uint8Array>;
  downloadCertificate(id: string): Promise<Uint8Array>;
  voidEnvelope(input: {
    id: string;
    reason: string;
    idempotencyKey: string;
  }): Promise<void>;
}

export class EsignProviderAdapter implements EsignPort {
  public constructor(
    private readonly client: EsignProviderClient,
    private readonly envelopeStore: EsignEnvelopeStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public capabilities(): Promise<EsignCapabilities> {
    return this.client.capabilities();
  }

  public async createEnvelope(
    input: Parameters<EsignPort["createEnvelope"]>[0],
  ): Promise<ProviderResult<EnvelopeRecord>> {
    if (input.envelopeId.trim().length === 0)
      return permanent("ENVELOPE_ID_REQUIRED", "Envelope ID is required");
    if (sha256(input.documentBytes) !== input.documentSha256)
      return permanent(
        "DOCUMENT_HASH_MISMATCH",
        "The document bytes do not match the canonical SHA-256 hash",
      );
    if (input.signers.length === 0)
      return permanent("SIGNER_REQUIRED", "At least one signer is required");
    try {
      const capabilities = await this.client.capabilities();
      const signingMode = selectSigningMode(input.preferredMode, capabilities);
      const created = await this.client.createEnvelope({
        documentBytes: input.documentBytes,
        signers: input.signers,
        mode: signingMode,
        redirectUrl: input.redirectUrl,
        externalReference: input.envelopeId,
        idempotencyKey: input.idempotencyKey,
      });
      const record: EnvelopeRecord = {
        envelopeId: input.envelopeId,
        providerEnvelopeId: created.id,
        accountId: input.accountId,
        documentId: input.documentId,
        state: created.state,
        signingMode,
        signingUrl: created.signingUrl,
        signers: input.signers,
        createdAt: this.now(),
      };
      await this.envelopeStore.save(record);
      return { ok: true, value: record };
    } catch (error) {
      return transient(error);
    }
  }

  public async getEnvelope(
    envelopeId: string,
  ): Promise<ProviderResult<EnvelopeRecord>> {
    try {
      const record = await this.envelopeStore.findByEnvelopeId(envelopeId);
      if (!record)
        return permanent("ENVELOPE_NOT_FOUND", "Envelope is not tracked");
      const latest = await this.client.getEnvelope(record.providerEnvelopeId);
      const updated: EnvelopeRecord = {
        ...record,
        state: latest.state,
        signingUrl: latest.signingUrl,
        createdAt: latest.createdAt,
      };
      await this.envelopeStore.save(updated);
      return { ok: true, value: updated };
    } catch (error) {
      return transient(error);
    }
  }

  public async retrieveCompletedEvidence(
    envelopeId: string,
  ): Promise<ProviderResult<CompletedEnvelopeEvidence>> {
    const state = await this.getEnvelope(envelopeId);
    if (!state.ok) return state;
    if (state.value.state !== "completed")
      return permanent(
        "ENVELOPE_NOT_COMPLETED",
        "Signed evidence is only available for completed envelopes",
      );
    try {
      const [signedPdf, certificate] = await Promise.all([
        this.client.downloadSignedPdf(state.value.providerEnvelopeId),
        this.client.downloadCertificate(state.value.providerEnvelopeId),
      ]);
      return {
        ok: true,
        value: {
          envelopeId,
          signedPdf,
          certificate,
          signedPdfSha256: sha256(signedPdf),
          certificateSha256: sha256(certificate),
          completedAt: this.now(),
        },
      };
    } catch (error) {
      return transient(error);
    }
  }

  public async voidEnvelope(
    input: Parameters<EsignPort["voidEnvelope"]>[0],
  ): Promise<ProviderResult<{ envelopeId: string; state: "voided" }>> {
    try {
      const current = await this.envelopeStore.findByEnvelopeId(
        input.envelopeId,
      );
      if (!current)
        return permanent("ENVELOPE_NOT_FOUND", "Envelope is not tracked");
      await this.client.voidEnvelope({
        id: current.providerEnvelopeId,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      });
      await this.envelopeStore.save({ ...current, state: "voided" });
      return {
        ok: true,
        value: { envelopeId: input.envelopeId, state: "voided" },
      };
    } catch (error) {
      return transient(error);
    }
  }
}

export interface FakeEsignOptions {
  capabilities?: Partial<EsignCapabilities>;
  now?: () => string;
}

export class FakeEsignAdapter implements EsignPort {
  private readonly envelopes = new Map<
    string,
    EnvelopeRecord & {
      documentBytes: Uint8Array;
      evidence?: CompletedEnvelopeEvidence;
    }
  >();
  private readonly keys = new Map<
    string,
    { fingerprint: string; envelopeId: string }
  >();
  private readonly supported: EsignCapabilities;
  private readonly now: () => string;

  public constructor(options: FakeEsignOptions = {}) {
    this.supported = {
      redirect: options.capabilities?.redirect ?? true,
      embedded: options.capabilities?.embedded ?? false,
      countersignature: options.capabilities?.countersignature ?? true,
    };
    this.now = options.now ?? (() => "2026-07-31T16:00:00.000Z");
  }

  public capabilities(): Promise<EsignCapabilities> {
    return Promise.resolve({ ...this.supported });
  }

  public createEnvelope(
    input: Parameters<EsignPort["createEnvelope"]>[0],
  ): Promise<ProviderResult<EnvelopeRecord>> {
    if (input.envelopeId.trim().length === 0)
      return Promise.resolve(
        permanent("ENVELOPE_ID_REQUIRED", "Envelope ID is required"),
      );
    if (sha256(input.documentBytes) !== input.documentSha256)
      return Promise.resolve(
        permanent("DOCUMENT_HASH_MISMATCH", "Document hash mismatch"),
      );
    if (input.signers.length === 0)
      return Promise.resolve(permanent("SIGNER_REQUIRED", "Signer required"));
    if (
      input.signers.some((signer) => signer.role === "fil_one") &&
      !this.supported.countersignature
    )
      return Promise.resolve(
        permanent(
          "COUNTERSIGNATURE_UNSUPPORTED",
          "The provider does not support counter-signing",
        ),
      );
    const fingerprint = sha256(
      new TextEncoder().encode(
        JSON.stringify({
          envelopeId: input.envelopeId,
          accountId: input.accountId,
          documentId: input.documentId,
          documentSha256: input.documentSha256,
          signers: input.signers,
          preferredMode: input.preferredMode,
          redirectUrl: input.redirectUrl,
        }),
      ),
    );
    const existing = this.keys.get(input.idempotencyKey);
    if (existing && existing.fingerprint !== fingerprint)
      return Promise.resolve(
        permanent("IDEMPOTENCY_CONFLICT", "Envelope key input changed"),
      );
    if (existing) {
      const envelope = this.envelopes.get(existing.envelopeId);
      if (!envelope) throw new Error("Fake e-sign index corruption");
      return Promise.resolve({ ok: true, value: envelope, duplicate: true });
    }
    let signingMode: SigningMode;
    try {
      signingMode = selectSigningMode(input.preferredMode, this.supported);
    } catch (error) {
      return Promise.resolve(permanent("SIGNING_UNAVAILABLE", String(error)));
    }
    const providerEnvelopeId = `env_fake_${sha256(new TextEncoder().encode(input.idempotencyKey)).slice(0, 20)}`;
    const record = {
      envelopeId: input.envelopeId,
      providerEnvelopeId,
      accountId: input.accountId,
      documentId: input.documentId,
      state: "sent" as const,
      signingMode,
      signingUrl: `https://esign.clockwork.test/${signingMode}/${providerEnvelopeId}`,
      signers: input.signers,
      createdAt: this.now(),
      documentBytes: input.documentBytes.slice(),
    };
    this.keys.set(input.idempotencyKey, {
      fingerprint,
      envelopeId: input.envelopeId,
    });
    this.envelopes.set(input.envelopeId, record);
    return Promise.resolve({ ok: true, value: record });
  }

  public getEnvelope(
    envelopeId: string,
  ): Promise<ProviderResult<EnvelopeRecord>> {
    const envelope = this.envelopes.get(envelopeId);
    return Promise.resolve(
      envelope
        ? { ok: true, value: envelope }
        : permanent("ENVELOPE_NOT_FOUND", "Envelope not found"),
    );
  }

  public retrieveCompletedEvidence(
    envelopeId: string,
  ): Promise<ProviderResult<CompletedEnvelopeEvidence>> {
    const envelope = this.envelopes.get(envelopeId);
    if (!envelope)
      return Promise.resolve(
        permanent("ENVELOPE_NOT_FOUND", "Envelope not found"),
      );
    if (envelope.state !== "completed" || !envelope.evidence)
      return Promise.resolve(
        permanent("ENVELOPE_NOT_COMPLETED", "Envelope is not completed"),
      );
    return Promise.resolve({
      ok: true,
      value: {
        ...envelope.evidence,
        signedPdf: envelope.evidence.signedPdf.slice(),
        certificate: envelope.evidence.certificate.slice(),
      },
    });
  }

  public voidEnvelope(
    input: Parameters<EsignPort["voidEnvelope"]>[0],
  ): Promise<ProviderResult<{ envelopeId: string; state: "voided" }>> {
    const envelope = this.envelopes.get(input.envelopeId);
    if (!envelope)
      return Promise.resolve(
        permanent("ENVELOPE_NOT_FOUND", "Envelope not found"),
      );
    this.envelopes.set(input.envelopeId, { ...envelope, state: "voided" });
    return Promise.resolve({
      ok: true,
      value: { envelopeId: input.envelopeId, state: "voided" },
    });
  }

  public complete(envelopeId: string): EsignProviderWebhookEvent {
    const envelope = this.envelopes.get(envelopeId);
    if (!envelope) throw new Error(`Envelope ${envelopeId} not found`);
    const signedPdf = new TextEncoder().encode(
      `signed:${envelope.documentId}:${envelope.providerEnvelopeId}`,
    );
    const certificate = new TextEncoder().encode(
      `certificate:${envelope.providerEnvelopeId}:${this.now()}`,
    );
    const evidence: CompletedEnvelopeEvidence = {
      envelopeId,
      signedPdf,
      certificate,
      signedPdfSha256: sha256(signedPdf),
      certificateSha256: sha256(certificate),
      completedAt: this.now(),
    };
    this.envelopes.set(envelopeId, {
      ...envelope,
      state: "completed",
      evidence,
    });
    return {
      id: `esign_evt_${sha256(new TextEncoder().encode(`${envelope.providerEnvelopeId}:completed`)).slice(0, 20)}`,
      envelopeId: envelope.providerEnvelopeId,
      data: {
        envelopeId: envelope.providerEnvelopeId,
        externalReference: envelope.envelopeId,
      },
      type: "envelope.completed",
      state: "completed",
      occurredAt: this.now(),
    };
  }
}

export interface EsignProviderWebhookEvent {
  id: string;
  /** Provider envelope ID repeated in data.envelopeId and covered by HMAC. */
  envelopeId: string;
  data: {
    envelopeId: string;
    externalReference: string;
  };
  type:
    | "envelope.sent"
    | "envelope.completed"
    | "envelope.declined"
    | "envelope.voided";
  state: EnvelopeState;
  occurredAt: string;
}

export interface EsignWebhookEvent {
  providerEventId: string;
  /** Commerce-owned envelope ID resolved from durable provider binding. */
  envelopeId: string;
  providerEnvelopeId: string;
  accountId: AccountId;
  documentId: DocumentId;
  type: EsignProviderWebhookEvent["type"];
  state: EnvelopeState;
  occurredAt: string;
}

export class EsignWebhookVerifier implements WebhookVerifier<EsignWebhookEvent> {
  public constructor(
    private readonly secret: string,
    private readonly envelopeStore: Pick<
      EsignEnvelopeStore,
      "findByProviderEnvelopeId"
    >,
    private readonly nowEpochSeconds: () => number = () =>
      Math.floor(Date.now() / 1000),
  ) {
    if (secret.length < 16)
      throw new Error(
        "E-sign webhook secrets must contain at least 16 characters",
      );
  }

  public async verify(
    input: Parameters<WebhookVerifier<EsignWebhookEvent>["verify"]>[0],
  ): Promise<WebhookVerificationResult<EsignWebhookEvent>> {
    const parsedHeader = parseSignatureHeader(input.signature);
    const age = Math.abs(this.nowEpochSeconds() - parsedHeader.timestamp);
    if (age > (input.toleranceSeconds ?? 300))
      throw new Error("E-sign webhook timestamp is outside tolerance");
    const signedPayload = concatForSignature(
      parsedHeader.timestamp,
      input.rawBody,
    );
    const expected = createHmac("sha256", this.secret)
      .update(signedPayload)
      .digest("hex");
    if (!safeEqualHex(expected, parsedHeader.signature))
      throw new Error("Invalid e-sign webhook signature");
    const providerEvent = parseWebhookEvent(input.rawBody);
    if (providerEvent.data.envelopeId !== providerEvent.envelopeId)
      throw new Error("E-sign webhook envelope identity mismatch");
    const binding = await this.envelopeStore.findByProviderEnvelopeId(
      providerEvent.envelopeId,
    );
    if (!binding) throw new Error("E-sign webhook envelope is not bound");
    if (providerEvent.data.externalReference !== binding.envelopeId)
      throw new Error("E-sign webhook external reference mismatch");
    const payload: EsignWebhookEvent = {
      providerEventId: providerEvent.id,
      envelopeId: binding.envelopeId,
      providerEnvelopeId: providerEvent.envelopeId,
      accountId: binding.accountId,
      documentId: binding.documentId,
      type: providerEvent.type,
      state: providerEvent.state,
      occurredAt: providerEvent.occurredAt,
    };
    return {
      eventId: providerEvent.id,
      occurredAt: payload.occurredAt,
      payload,
    };
  }
}

export function signFakeEsignWebhook(input: {
  secret: string;
  timestamp: number;
  rawBody: Uint8Array;
}): string {
  const signature = createHmac("sha256", input.secret)
    .update(concatForSignature(input.timestamp, input.rawBody))
    .digest("hex");
  return `t=${input.timestamp},v1=${signature}`;
}

function selectSigningMode(
  preferred: SigningMode,
  capabilities: EsignCapabilities,
): SigningMode {
  if (preferred === "embedded" && capabilities.embedded) return "embedded";
  if (capabilities.redirect) return "redirect";
  if (capabilities.embedded) return "embedded";
  throw new Error("The e-sign provider has no supported signing mode");
}

function parseSignatureHeader(header: string): {
  timestamp: number;
  signature: string;
} {
  let timestampText: string | undefined;
  let signature: string | undefined;
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") timestampText = value;
    if (key === "v1") signature = value;
  }
  const timestamp = Number(timestampText);
  if (!Number.isInteger(timestamp) || !signature)
    throw new Error("Malformed e-sign webhook signature header");
  return { timestamp, signature };
}

function concatForSignature(timestamp: number, body: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const result = new Uint8Array(prefix.length + body.length);
  result.set(prefix);
  result.set(body, prefix.length);
  return result;
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(right)) return false;
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function parseWebhookEvent(rawBody: Uint8Array): EsignProviderWebhookEvent {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    throw new Error("Malformed e-sign webhook payload");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("envelopeId" in value) ||
    typeof value.envelopeId !== "string" ||
    !("data" in value) ||
    typeof value.data !== "object" ||
    value.data === null ||
    !("envelopeId" in value.data) ||
    typeof value.data.envelopeId !== "string" ||
    !("externalReference" in value.data) ||
    typeof value.data.externalReference !== "string" ||
    !("type" in value) ||
    typeof value.type !== "string" ||
    !("state" in value) ||
    typeof value.state !== "string" ||
    !("occurredAt" in value) ||
    typeof value.occurredAt !== "string"
  )
    throw new Error("Malformed e-sign webhook payload");
  const types = new Set([
    "envelope.sent",
    "envelope.completed",
    "envelope.declined",
    "envelope.voided",
  ]);
  const states = new Set([
    "created",
    "sent",
    "viewed",
    "completed",
    "declined",
    "voided",
  ]);
  if (!types.has(value.type) || !states.has(value.state))
    throw new Error("Unsupported e-sign webhook event");
  const expectedState = value.type.slice("envelope.".length);
  if (value.state !== expectedState)
    throw new Error("E-sign webhook type and state mismatch");
  if (!isInstant(value.occurredAt))
    throw new Error("Malformed e-sign webhook occurrence time");
  return value as EsignProviderWebhookEvent;
}

function cloneEnvelope(record: EnvelopeRecord): EnvelopeRecord {
  return {
    ...record,
    signers: record.signers.map((signer) => ({ ...signer })),
  };
}

function isInstant(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function permanent(code: string, message: string): ProviderResult<never> {
  return { ok: false, kind: "permanent", code, message };
}

function transient(error: unknown): ProviderResult<never> {
  return {
    ok: false,
    kind: "transient",
    code: "ESIGN_PROVIDER_ERROR",
    message: error instanceof Error ? error.message : "Unknown provider error",
  };
}
