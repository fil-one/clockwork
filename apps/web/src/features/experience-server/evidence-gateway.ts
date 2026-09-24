// i18n-exempt-file: HTTP API problem+json titles are the integrator contract (stable English, logged); an interface shows the reader a sentence chosen from `code`/`status` (problem-text.ts), never this title; provider-response checks and the Bearer header are protocol, not copy.
import { createHash } from "node:crypto";

import { findDemoProductionMarker } from "@clockwork/testing/demo-state";

import { ExperienceProblem, type EvidenceUploadRecord } from "./model";

export interface GatewayUploadReservation {
  providerUploadId: string;
  quarantineKey: string;
  method: "PUT";
  uploadUrl: string;
  headers: Readonly<Record<string, string>>;
  expiresAt: string;
}

export type GatewayCompletion =
  | {
      clean: true;
      immutableStorageKey: string;
      storageVersionId: string;
      scanReference: string;
      contentHash: string;
      byteLength: string;
      mimeType: string;
    }
  | {
      clean: false;
      scanReference: string;
      failureCode: string;
    };

export interface GatewayStoredObject {
  storageKey: string;
  storageVersionId: string;
  contentHash: string;
  byteLength: string;
  mimeType: string;
  scanReference: string;
}

export interface GatewayReadObject {
  bytes: Uint8Array;
  contentHash: string;
  byteLength: string;
  mimeType: string;
  filename: string;
}

export interface EvidenceGateway {
  reserveUpload(
    upload: EvidenceUploadRecord,
  ): Promise<GatewayUploadReservation>;
  completeUpload(upload: EvidenceUploadRecord): Promise<GatewayCompletion>;
  createDownload(
    upload: EvidenceUploadRecord,
    expiresInSeconds: number,
  ): Promise<{ url: string; expiresAt: string }>;
  storeImmutable(input: {
    bytes: Uint8Array;
    contentHash: string;
    mimeType: string;
    retainUntil: string;
    accountId: string | null;
    internalScopeId?: string;
    source: string;
  }): Promise<GatewayStoredObject>;
  readImmutable(input: {
    storageKey: string;
    storageVersionId: string;
    contentHash: string;
    byteLength: string;
    mimeType: string;
    filename: string;
  }): Promise<GatewayReadObject>;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ExperienceProblem(
      502,
      "EVIDENCE_PROVIDER_INVALID",
      "Evidence provider returned an invalid response",
    );
  return value as Record<string, unknown>;
}

function text(value: Record<string, unknown>, key: string): string {
  const item = value[key];
  if (typeof item !== "string" || !item)
    throw new ExperienceProblem(
      502,
      "EVIDENCE_PROVIDER_INVALID",
      `Evidence provider omitted ${key}`,
    );
  return item;
}

function trustedProviderUrl(
  raw: string,
  allowedOrigins: readonly string[],
): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ExperienceProblem(
      502,
      "EVIDENCE_PROVIDER_URL_INVALID",
      "Evidence provider returned an invalid URL",
    );
  }
  const local = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (
    !allowedOrigins.includes(url.origin) ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password
  )
    throw new ExperienceProblem(
      502,
      "EVIDENCE_PROVIDER_URL_FORBIDDEN",
      "Evidence provider returned an untrusted URL",
    );
  return url.toString();
}

function providerExpiry(
  raw: string,
  maximumEpochMs: number,
  code: "EVIDENCE_UPLOAD_EXPIRY_INVALID" | "EVIDENCE_DOWNLOAD_EXPIRY_INVALID",
): string {
  const expiresAt = Date.parse(raw);
  const now = Date.now();
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    expiresAt > maximumEpochMs + 5_000
  )
    throw new ExperienceProblem(
      502,
      code,
      "Evidence provider returned an invalid credential expiry",
    );
  return new Date(expiresAt).toISOString();
}

const SAFE_UPLOAD_HEADERS = new Set([
  "content-type",
  "x-amz-checksum-sha256",
  "x-amz-content-sha256",
  "x-amz-server-side-encryption",
  "x-amz-server-side-encryption-aws-kms-key-id",
]);

export function safeUploadHeaders(value: Record<string, unknown>) {
  const entries = Object.entries(value).map(([rawKey, item]) => {
    const key = rawKey.toLowerCase();
    if (!SAFE_UPLOAD_HEADERS.has(key) || typeof item !== "string" || !item)
      throw new ExperienceProblem(
        502,
        "EVIDENCE_PROVIDER_HEADER_FORBIDDEN",
        "Evidence provider returned an unsafe upload header",
      );
    return [key, item] as const;
  });
  return Object.freeze(Object.fromEntries(entries));
}

export class HttpEvidenceGateway implements EvidenceGateway {
  private readonly baseUrl: URL;
  private readonly allowedOrigins: readonly string[];

  public constructor(configuration: {
    baseUrl: string;
    bearerToken: string;
    allowedClientOrigins: readonly string[];
    fetchImplementation?: typeof fetch;
  }) {
    this.baseUrl = new URL(configuration.baseUrl);
    const local = ["127.0.0.1", "localhost", "::1"].includes(
      this.baseUrl.hostname,
    );
    if (
      this.baseUrl.protocol !== "https:" &&
      !(this.baseUrl.protocol === "http:" && local)
    )
      throw new Error("Evidence storage gateway must use HTTPS");
    if (configuration.bearerToken.length < 32)
      throw new Error("Evidence storage gateway token is invalid");
    this.token = configuration.bearerToken;
    this.allowedOrigins = configuration.allowedClientOrigins;
    // `fetch` accepts only its own global as the receiver. Calling it as a
    // property of this gateway throws before the request is sent.
    this.fetchImplementation = (
      configuration.fetchImplementation ?? fetch
    ).bind(globalThis);
  }

  private readonly token: string;
  private readonly fetchImplementation: typeof fetch;

  private async call(
    path: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const response = await this.fetchImplementation(
      new URL(path, this.baseUrl),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok)
      throw new ExperienceProblem(
        response.status >= 500 ? 503 : 502,
        "EVIDENCE_PROVIDER_UNAVAILABLE",
        "Evidence storage provider did not accept the operation",
      );
    return object(await response.json());
  }

  public async reserveUpload(
    upload: EvidenceUploadRecord,
  ): Promise<GatewayUploadReservation> {
    const value = await this.call("v1/uploads", {
      externalUploadId: upload.uploadId,
      contentHash: upload.contentHash,
      contentLength: upload.byteLength,
      contentType: upload.mimeType,
      retainUntil: upload.retainUntil,
      legalHold: upload.legalHold,
      scope: {
        kind: upload.accountId ? "account" : "internal",
        id: upload.accountId ?? upload.ownerUserId,
      },
      source: `${upload.journey}:${upload.targetId}`,
    });
    const headers = object(value.headers);
    const expiresAt = providerExpiry(
      text(value, "expiresAt"),
      Date.parse(upload.expiresAt),
      "EVIDENCE_UPLOAD_EXPIRY_INVALID",
    );
    return {
      providerUploadId: text(value, "uploadId"),
      quarantineKey: text(value, "storageKey"),
      method: "PUT",
      uploadUrl: trustedProviderUrl(text(value, "url"), this.allowedOrigins),
      headers: safeUploadHeaders(headers),
      expiresAt,
    };
  }

  public async completeUpload(
    upload: EvidenceUploadRecord,
  ): Promise<GatewayCompletion> {
    const value = await this.call(
      `v1/uploads/${encodeURIComponent(upload.providerUploadId ?? "")}/complete`,
      {
        externalUploadId: upload.uploadId,
        contentHash: upload.contentHash,
        contentLength: upload.byteLength,
        contentType: upload.mimeType,
      },
    );
    if (value.clean !== true)
      return {
        clean: false,
        scanReference: text(value, "scanReference"),
        failureCode: text(value, "failureCode"),
      };
    return {
      clean: true,
      immutableStorageKey: text(value, "storageKey"),
      storageVersionId: text(value, "versionId"),
      scanReference: text(value, "scanReference"),
      contentHash: text(value, "contentHash"),
      byteLength: text(value, "byteLength"),
      mimeType: text(value, "mimeType"),
    };
  }

  public async createDownload(
    upload: EvidenceUploadRecord,
    expiresInSeconds: number,
  ) {
    if (
      !Number.isSafeInteger(expiresInSeconds) ||
      expiresInSeconds < 1 ||
      expiresInSeconds > 300
    )
      throw new ExperienceProblem(
        422,
        "EVIDENCE_DOWNLOAD_TTL_INVALID",
        "Evidence download expiry is invalid",
      );
    const value = await this.call(
      `v1/documents/${encodeURIComponent(upload.documentId ?? "")}/downloads`,
      {
        contentHash: upload.contentHash,
        versionId: upload.storageVersionId,
        expiresInSeconds,
      },
    );
    const expiresAt = providerExpiry(
      text(value, "expiresAt"),
      Date.now() + expiresInSeconds * 1000,
      "EVIDENCE_DOWNLOAD_EXPIRY_INVALID",
    );
    return {
      url: trustedProviderUrl(text(value, "url"), this.allowedOrigins),
      expiresAt,
    };
  }

  public async storeImmutable(input: {
    bytes: Uint8Array;
    contentHash: string;
    mimeType: string;
    retainUntil: string;
    accountId: string | null;
    internalScopeId?: string;
    source: string;
  }): Promise<GatewayStoredObject> {
    const value = await this.call("v1/immutable-objects", {
      bytes: Buffer.from(input.bytes).toString("base64"),
      contentHash: input.contentHash,
      contentLength: input.bytes.byteLength,
      contentType: input.mimeType,
      retainUntil: input.retainUntil,
      scope: input.accountId
        ? { kind: "account", id: input.accountId }
        : { kind: "internal", id: input.internalScopeId },
      source: input.source,
    });
    return {
      storageKey: text(value, "storageKey"),
      storageVersionId: text(value, "versionId"),
      contentHash: text(value, "contentHash"),
      byteLength: text(value, "byteLength"),
      mimeType: text(value, "mimeType"),
      scanReference: text(value, "scanReference"),
    };
  }

  public async readImmutable(input: {
    storageKey: string;
    storageVersionId: string;
    contentHash: string;
    byteLength: string;
    mimeType: string;
    filename: string;
  }): Promise<GatewayReadObject> {
    const value = await this.call("v1/immutable-objects/read", input);
    return {
      bytes: Uint8Array.from(Buffer.from(text(value, "bytes"), "base64")),
      contentHash: text(value, "contentHash"),
      byteLength: text(value, "byteLength"),
      mimeType: text(value, "mimeType"),
      filename: input.filename,
    };
  }
}

/** Explicit local-only adapter. It is never selected by environment inference. */
export class DemoEvidenceGateway implements EvidenceGateway {
  private readonly objects = new Map<string, GatewayReadObject>();

  public reserveUpload(
    upload: EvidenceUploadRecord,
  ): Promise<GatewayUploadReservation> {
    return Promise.resolve({
      providerUploadId: `demo_${upload.uploadId}`,
      quarantineKey: `demo/quarantine/${upload.uploadId}`,
      method: "PUT",
      uploadUrl: `https://evidence.clockwork.test/upload/${upload.uploadId}`,
      headers: {
        "content-type": upload.mimeType,
        "x-content-sha256": upload.contentHash,
      },
      expiresAt: upload.expiresAt,
    });
  }

  public completeUpload(
    upload: EvidenceUploadRecord,
  ): Promise<GatewayCompletion> {
    return Promise.resolve({
      clean: true,
      immutableStorageKey: `demo/immutable/${upload.contentHash}`,
      storageVersionId: `demo_v_${upload.contentHash.slice(0, 16)}`,
      scanReference: `demo_scan_${upload.contentHash.slice(0, 16)}`,
      contentHash: upload.contentHash,
      byteLength: upload.byteLength,
      mimeType: upload.mimeType,
    });
  }

  public createDownload(
    upload: EvidenceUploadRecord,
    expiresInSeconds: number,
  ) {
    if (
      !Number.isSafeInteger(expiresInSeconds) ||
      expiresInSeconds < 1 ||
      expiresInSeconds > 300
    )
      throw new ExperienceProblem(
        422,
        "EVIDENCE_DOWNLOAD_TTL_INVALID",
        "Evidence download expiry is invalid",
      );
    return Promise.resolve({
      url: `https://evidence.clockwork.test/download/${upload.documentId}?version=${encodeURIComponent(upload.storageVersionId ?? "")}`,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    });
  }

  public storeImmutable(input: {
    bytes: Uint8Array;
    contentHash: string;
    mimeType: string;
  }): Promise<GatewayStoredObject> {
    if (
      createHash("sha256").update(input.bytes).digest("hex") !==
      input.contentHash
    )
      throw new ExperienceProblem(
        502,
        "DEMO_STORAGE_HASH_MISMATCH",
        "Demo artifact hash mismatch",
      );
    const storageKey = `demo/immutable/${input.contentHash}`;
    const storageVersionId = `demo_v_${input.contentHash.slice(0, 16)}`;
    this.objects.set(`${storageKey}:${storageVersionId}`, {
      bytes: input.bytes.slice(),
      contentHash: input.contentHash,
      byteLength: input.bytes.byteLength.toString(),
      mimeType: input.mimeType,
      filename: "artifact.pdf",
    });
    return Promise.resolve({
      storageKey,
      storageVersionId,
      contentHash: input.contentHash,
      byteLength: input.bytes.byteLength.toString(),
      mimeType: input.mimeType,
      scanReference: `demo_scan_${input.contentHash.slice(0, 16)}`,
    });
  }

  public readImmutable(input: {
    storageKey: string;
    storageVersionId: string;
    filename: string;
  }): Promise<GatewayReadObject> {
    const stored = this.objects.get(
      `${input.storageKey}:${input.storageVersionId}`,
    );
    if (!stored)
      throw new ExperienceProblem(
        404,
        "DEMO_ARTIFACT_NOT_FOUND",
        "Demo artifact not found",
      );
    return Promise.resolve({
      ...stored,
      filename: input.filename,
      bytes: stored.bytes.slice(),
    });
  }
}

export function configuredEvidenceGateway(): EvidenceGateway {
  const adapter = process.env.CLOCKWORK_EVIDENCE_ADAPTER?.trim();
  if (adapter === "demo") {
    if (findDemoProductionMarker(process.env))
      throw new ExperienceProblem(
        503,
        "DEMO_ADAPTER_FORBIDDEN",
        "Demo evidence adapter is disabled in production",
      );
    return demoGateway;
  }
  if (adapter && adapter !== "production")
    throw new ExperienceProblem(
      503,
      "EVIDENCE_ADAPTER_INVALID",
      "Evidence adapter selection is invalid",
    );
  const baseUrl = process.env.EVIDENCE_STORAGE_INTERNAL_URL?.trim();
  const token = process.env.EVIDENCE_STORAGE_INTERNAL_TOKEN?.trim();
  const origins = (process.env.EVIDENCE_CLIENT_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (!baseUrl || !token || origins.length === 0)
    throw new ExperienceProblem(
      503,
      "EVIDENCE_PROVIDER_UNAVAILABLE",
      "Evidence storage is not configured",
    );
  return new HttpEvidenceGateway({
    baseUrl,
    bearerToken: token,
    allowedClientOrigins: origins,
  });
}

const demoGateway = new DemoEvidenceGateway();
