import { createHash } from "node:crypto";

import {
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type {
  DocumentId,
  IdempotencyKey,
  ProviderResult,
} from "@clockwork/contracts";
import { ids } from "@clockwork/contracts";

export type EvidenceKind =
  | "agreement"
  | "acceptance"
  | "quote"
  | "order_form"
  | "amendment"
  | "notice"
  | "completion_certificate"
  | "deletion_certificate"
  | "screening"
  | "approval";

export interface EvidenceMetadata {
  kind: EvidenceKind;
  contentHash: string;
  contentType: string;
  retainUntil: string;
  legalHold: boolean;
  source: string;
  scope: EvidenceScope;
  scanStatus: "pending" | "clean" | "quarantined";
  scanReference: string;
}

export interface EvidenceScope {
  kind: "account" | "organization" | "internal";
  id: string;
}

export interface EvidenceAccessContext {
  principalId: string;
  scopes: readonly EvidenceScope[];
}

export interface EvidenceAccessAuthorizer {
  authorize(input: {
    action: "read";
    access: EvidenceAccessContext;
    metadata: Readonly<EvidenceMetadata>;
  }): Promise<boolean>;
}

export class ScopeMatchingEvidenceAccessAuthorizer implements EvidenceAccessAuthorizer {
  public authorize(input: {
    action: "read";
    access: EvidenceAccessContext;
    metadata: Readonly<EvidenceMetadata>;
  }): Promise<boolean> {
    return Promise.resolve(
      input.access.principalId.length > 0 &&
        input.access.scopes.some(
          (scope) =>
            scope.kind === input.metadata.scope.kind &&
            scope.id === input.metadata.scope.id,
        ),
    );
  }
}

export interface EvidenceObject {
  documentId: DocumentId;
  storageKey: string;
  versionId: string;
  metadata: Readonly<EvidenceMetadata>;
  scanReference: string;
}

export interface EvidenceRead extends EvidenceObject {
  bytes: Uint8Array;
}

export interface PresignedEvidenceUpload {
  uploadId: string;
  method: "PUT";
  url: string;
  headers: Readonly<Record<string, string>>;
  storageKey: string;
  expiresAt: string;
}

export interface EvidenceStoragePort {
  putImmutable(input: {
    kind: EvidenceKind;
    bytes: Uint8Array;
    contentHash: string;
    contentType: string;
    retainUntil: string;
    legalHold?: boolean;
    source: string;
    scope: EvidenceScope;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<EvidenceObject>>;
  get(input: {
    documentId: DocumentId;
    contentHash: string;
    versionId?: string;
    access: EvidenceAccessContext;
  }): Promise<ProviderResult<EvidenceRead>>;
  createPresignedUpload(input: {
    kind: EvidenceKind;
    contentHash: string;
    contentLength: number;
    contentType: string;
    retainUntil: string;
    legalHold?: boolean;
    source: string;
    scope: EvidenceScope;
    idempotencyKey: IdempotencyKey;
    expiresInSeconds?: number;
  }): Promise<ProviderResult<PresignedEvidenceUpload>>;
  completePresignedUpload(input: {
    uploadId: string;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<EvidenceObject>>;
  createPresignedDownload(input: {
    documentId: DocumentId;
    contentHash: string;
    versionId: string;
    access: EvidenceAccessContext;
    expiresInSeconds?: number;
  }): Promise<ProviderResult<{ url: string; expiresAt: string }>>;
}

export interface MalwareScanResult {
  clean: boolean;
  reference: string;
  findings?: readonly string[];
}

export interface MalwareScanner {
  scan(input: {
    bytes: Uint8Array;
    contentHash: string;
    contentType: string;
  }): Promise<MalwareScanResult>;
}

export class DeterministicMalwareScanner implements MalwareScanner {
  public scan(input: {
    bytes: Uint8Array;
    contentHash: string;
    contentType: string;
  }): Promise<MalwareScanResult> {
    const text = new TextDecoder().decode(input.bytes);
    const infected = text.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE");
    return Promise.resolve({
      clean: !infected,
      reference: `scan_${input.contentHash.slice(0, 24)}`,
      ...(infected ? { findings: ["EICAR_TEST_SIGNATURE"] } : {}),
    });
  }
}

interface S3CommandClient {
  send(command: unknown): Promise<unknown>;
}

export interface S3CommandPresigner {
  sign(command: unknown, expiresInSeconds: number): Promise<string>;
}

export interface S3EvidenceStorageOptions {
  client: S3CommandClient;
  presigner: S3CommandPresigner;
  scanner: MalwareScanner;
  pendingUploads: PendingEvidenceUploadStore;
  authorizer: EvidenceAccessAuthorizer;
  bucket: string;
  expectedBucketOwner: string;
  kmsKeyId?: string;
  prefix?: string;
  quarantinePrefix?: string;
  now?: () => Date;
}

export interface PendingUpload {
  input: Parameters<EvidenceStoragePort["createPresignedUpload"]>[0];
  quarantineKey: string;
  expiresAt: string;
  status: "pending" | "quarantined" | "completed";
  scanReference?: string;
  completedObject?: EvidenceObject;
}

export interface PendingEvidenceUploadStore {
  reserve(
    uploadId: string,
    value: PendingUpload,
  ): Promise<"created" | "existing" | "conflict">;
  get(uploadId: string): Promise<PendingUpload | null>;
  markQuarantined(uploadId: string, scanReference: string): Promise<void>;
  markCompleted(uploadId: string, object: EvidenceObject): Promise<void>;
}

/** Test/sandbox helper. Production must inject a durable implementation. */
export class InMemoryPendingEvidenceUploadStore implements PendingEvidenceUploadStore {
  private readonly values = new Map<string, PendingUpload>();

  public reserve(
    uploadId: string,
    value: PendingUpload,
  ): Promise<"created" | "existing" | "conflict"> {
    const existing = this.values.get(uploadId);
    if (!existing) {
      this.values.set(uploadId, structuredClone(value));
      return Promise.resolve("created");
    }
    return Promise.resolve(
      stableJson(existing.input) === stableJson(value.input) &&
        existing.quarantineKey === value.quarantineKey
        ? "existing"
        : "conflict",
    );
  }

  public get(uploadId: string): Promise<PendingUpload | null> {
    const value = this.values.get(uploadId);
    return Promise.resolve(value ? structuredClone(value) : null);
  }

  public markQuarantined(
    uploadId: string,
    scanReference: string,
  ): Promise<void> {
    const value = this.values.get(uploadId);
    if (value)
      this.values.set(uploadId, {
        ...value,
        status: "quarantined",
        scanReference,
      });
    return Promise.resolve();
  }

  public markCompleted(
    uploadId: string,
    object: EvidenceObject,
  ): Promise<void> {
    const value = this.values.get(uploadId);
    if (value)
      this.values.set(uploadId, {
        ...value,
        status: "completed",
        completedObject: structuredClone(object),
      });
    return Promise.resolve();
  }
}

export class S3EvidenceStorageAdapter implements EvidenceStoragePort {
  private readonly client: S3CommandClient;
  private readonly presigner: S3CommandPresigner;
  private readonly scanner: MalwareScanner;
  private readonly pendingUploads: PendingEvidenceUploadStore;
  private readonly authorizer: EvidenceAccessAuthorizer;
  private readonly bucket: string;
  private readonly expectedBucketOwner: string;
  private readonly kmsKeyId: string | undefined;
  private readonly prefix: string;
  private readonly quarantinePrefix: string;
  private readonly now: () => Date;

  public constructor(options: S3EvidenceStorageOptions) {
    if (!/^\d{12}$/.test(options.expectedBucketOwner))
      throw new Error("expectedBucketOwner must be a 12 digit AWS account ID");
    this.client = options.client;
    this.presigner = options.presigner;
    this.scanner = options.scanner;
    this.pendingUploads = options.pendingUploads;
    this.authorizer = options.authorizer;
    this.bucket = options.bucket;
    this.expectedBucketOwner = options.expectedBucketOwner;
    this.kmsKeyId = options.kmsKeyId;
    this.prefix = (options.prefix ?? "evidence/sha256").replace(/\/$/, "");
    this.quarantinePrefix = (
      options.quarantinePrefix ?? "evidence/quarantine"
    ).replace(/\/$/, "");
    this.now = options.now ?? (() => new Date());
  }

  public async validateBucketConfiguration(): Promise<void> {
    const [versioningValue, lockValue] = await Promise.all([
      this.client.send(
        new GetBucketVersioningCommand({
          Bucket: this.bucket,
          ExpectedBucketOwner: this.expectedBucketOwner,
        }),
      ),
      this.client.send(
        new GetObjectLockConfigurationCommand({
          Bucket: this.bucket,
          ExpectedBucketOwner: this.expectedBucketOwner,
        }),
      ),
    ]);
    const versioning = versioningValue as { Status?: string };
    const lock = lockValue as {
      ObjectLockConfiguration?: { ObjectLockEnabled?: string };
    };
    if (versioning.Status !== "Enabled")
      throw new Error("Evidence bucket versioning must be enabled");
    if (lock.ObjectLockConfiguration?.ObjectLockEnabled !== "Enabled")
      throw new Error("Evidence bucket Object Lock must be enabled");
  }

  public async putImmutable(
    input: Parameters<EvidenceStoragePort["putImmutable"]>[0],
  ): Promise<ProviderResult<EvidenceObject>> {
    const validation = validateEvidenceInput(input, this.now());
    if (validation) return validation;
    const scan = await this.scanner.scan(input);
    if (!scan.clean)
      return permanent(
        "MALWARE_DETECTED",
        `Evidence was rejected by malware scan ${scan.reference}`,
      );
    return this.putCleanImmutable(input, scan.reference);
  }

  public async get(
    input: Parameters<EvidenceStoragePort["get"]>[0],
  ): Promise<ProviderResult<EvidenceRead>> {
    if (documentIdFor(input.contentHash) !== input.documentId)
      return permanent(
        "DOCUMENT_HASH_REFERENCE_MISMATCH",
        "Document ID and repository content hash do not identify the same evidence",
      );
    return this.getByHash(
      input.contentHash,
      input.documentId,
      input.access,
      input.versionId,
    );
  }

  public async createPresignedUpload(
    input: Parameters<EvidenceStoragePort["createPresignedUpload"]>[0],
  ): Promise<ProviderResult<PresignedEvidenceUpload>> {
    const validation = validateUploadInput(input, this.now());
    if (validation) return validation;
    const expiresInSeconds = input.expiresInSeconds ?? 900;
    if (expiresInSeconds < 60 || expiresInSeconds > 900)
      return permanent(
        "INVALID_EXPIRY",
        "Evidence upload URLs must expire between 60 and 900 seconds",
      );
    const uploadId = `upload_${sha256Text(input.idempotencyKey).slice(0, 24)}`;
    const quarantineKey = `${this.quarantinePrefix}/${uploadId}`;
    const expiresAt = new Date(
      this.now().getTime() + expiresInSeconds * 1000,
    ).toISOString();
    const headers = Object.freeze({
      "content-type": input.contentType,
      "x-amz-checksum-sha256": Buffer.from(input.contentHash, "hex").toString(
        "base64",
      ),
      ...(this.kmsKeyId
        ? {
            "x-amz-server-side-encryption": "aws:kms",
            "x-amz-server-side-encryption-aws-kms-key-id": this.kmsKeyId,
          }
        : { "x-amz-server-side-encryption": "AES256" }),
    });
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: quarantineKey,
        ContentLength: input.contentLength,
        ContentType: input.contentType,
        ChecksumSHA256: headers["x-amz-checksum-sha256"],
        Metadata: {
          "upload-id": uploadId,
          "declared-content-hash": input.contentHash,
          quarantine: "true",
        },
        ExpectedBucketOwner: this.expectedBucketOwner,
        ...(this.kmsKeyId
          ? {
              ServerSideEncryption: "aws:kms" as const,
              SSEKMSKeyId: this.kmsKeyId,
            }
          : { ServerSideEncryption: "AES256" as const }),
      });
      const url = await this.presigner.sign(command, expiresInSeconds);
      const reservation = await this.pendingUploads.reserve(uploadId, {
        input,
        quarantineKey,
        expiresAt,
        status: "pending",
      });
      if (reservation === "conflict")
        return permanent(
          "IDEMPOTENCY_CONFLICT",
          "Evidence upload key was reused for different immutable metadata",
        );
      return {
        ok: true,
        value: {
          uploadId,
          method: "PUT",
          url,
          headers,
          storageKey: quarantineKey,
          expiresAt,
        },
      };
    } catch (error) {
      return providerError(error);
    }
  }

  public async completePresignedUpload(
    input: Parameters<EvidenceStoragePort["completePresignedUpload"]>[0],
  ): Promise<ProviderResult<EvidenceObject>> {
    const pending = await this.pendingUploads.get(input.uploadId);
    if (!pending)
      return permanent("UPLOAD_NOT_FOUND", "Pending evidence upload not found");
    if (pending.status === "completed" && pending.completedObject)
      return { ok: true, value: pending.completedObject, duplicate: true };
    if (pending.status === "quarantined")
      return permanent(
        "MALWARE_DETECTED",
        `Evidence remains quarantined after scan ${pending.scanReference ?? "unknown"}`,
      );
    let bytes: Uint8Array;
    try {
      const response = (await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: pending.quarantineKey,
          ExpectedBucketOwner: this.expectedBucketOwner,
          ChecksumMode: "ENABLED",
        }),
      )) as {
        Body?: { transformToByteArray(): Promise<Uint8Array> } | Uint8Array;
      };
      bytes = await bodyToBytes(response.Body);
    } catch (error) {
      if (isNotFound(error))
        return permanent(
          "UPLOAD_NOT_FOUND",
          "Quarantine upload object not found",
        );
      return providerError(error);
    }
    if (bytes.byteLength !== pending.input.contentLength)
      return permanent(
        "CONTENT_LENGTH_MISMATCH",
        "Uploaded evidence length differs from the declared length",
      );
    if (sha256(bytes) !== pending.input.contentHash)
      return permanent(
        "CONTENT_HASH_MISMATCH",
        "Uploaded evidence differs from the declared SHA-256 hash",
      );
    const scan = await this.scanner.scan({
      bytes,
      contentHash: pending.input.contentHash,
      contentType: pending.input.contentType,
    });
    if (!scan.clean) {
      await this.pendingUploads.markQuarantined(input.uploadId, scan.reference);
      return permanent(
        "MALWARE_DETECTED",
        `Evidence remains outside immutable storage after scan ${scan.reference}`,
      );
    }
    const promoted = await this.putCleanImmutable(
      {
        kind: pending.input.kind,
        bytes,
        contentHash: pending.input.contentHash,
        contentType: pending.input.contentType,
        retainUntil: pending.input.retainUntil,
        ...(pending.input.legalHold === undefined
          ? {}
          : { legalHold: pending.input.legalHold }),
        source: pending.input.source,
        scope: pending.input.scope,
        idempotencyKey: input.idempotencyKey,
      },
      scan.reference,
    );
    if (!promoted.ok) return promoted;
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: pending.quarantineKey,
          ExpectedBucketOwner: this.expectedBucketOwner,
        }),
      );
      await this.pendingUploads.markCompleted(input.uploadId, promoted.value);
    } catch (error) {
      return providerError(error);
    }
    return promoted;
  }

  public async createPresignedDownload(
    input: Parameters<EvidenceStoragePort["createPresignedDownload"]>[0],
  ): Promise<ProviderResult<{ url: string; expiresAt: string }>> {
    if (documentIdFor(input.contentHash) !== input.documentId)
      return permanent(
        "DOCUMENT_HASH_REFERENCE_MISMATCH",
        "Document ID and repository content hash do not identify the same evidence",
      );
    const expiresInSeconds = input.expiresInSeconds ?? 300;
    if (expiresInSeconds < 30 || expiresInSeconds > 900)
      return permanent(
        "INVALID_EXPIRY",
        "Evidence download URLs must expire between 30 and 900 seconds",
      );
    const storageKey = keyFor(this.prefix, input.contentHash);
    try {
      const existing = await this.head(storageKey, input.versionId);
      if (!existing || existing.VersionId !== input.versionId)
        return permanent(
          "EVIDENCE_NOT_FOUND",
          "Evidence object version not found",
        );
      const metadata = parseS3Metadata(existing.Metadata);
      if (
        existing.Metadata?.immutable !== "true" ||
        !validCleanMetadata(metadata, input.contentHash)
      )
        return permanent(
          "EVIDENCE_NOT_CLEAN",
          "Only malware-scanned immutable evidence may be downloaded",
        );
      if (
        !(await this.authorizer.authorize({
          action: "read",
          access: input.access,
          metadata,
        }))
      )
        return permanent(
          "EVIDENCE_ACCESS_DENIED",
          "Principal is not authorized for the evidence scope",
        );
      const url = await this.presigner.sign(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
          VersionId: input.versionId,
          ExpectedBucketOwner: this.expectedBucketOwner,
        }),
        expiresInSeconds,
      );
      return {
        ok: true,
        value: {
          url,
          expiresAt: new Date(
            this.now().getTime() + expiresInSeconds * 1000,
          ).toISOString(),
        },
      };
    } catch (error) {
      return providerError(error);
    }
  }

  private async putCleanImmutable(
    input: Parameters<EvidenceStoragePort["putImmutable"]>[0],
    scanReference: string,
  ): Promise<ProviderResult<EvidenceObject>> {
    const storageKey = keyFor(this.prefix, input.contentHash);
    try {
      const existing = await this.head(storageKey);
      if (existing) return existingEvidenceResult(existing, input, storageKey);
      const responseValue = await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
          Body: input.bytes,
          ContentLength: input.bytes.byteLength,
          ContentType: input.contentType,
          ChecksumSHA256: Buffer.from(input.contentHash, "hex").toString(
            "base64",
          ),
          Metadata: toS3Metadata(input, scanReference),
          ObjectLockMode: "COMPLIANCE",
          ObjectLockRetainUntilDate: new Date(input.retainUntil),
          ObjectLockLegalHoldStatus: input.legalHold ? "ON" : "OFF",
          ExpectedBucketOwner: this.expectedBucketOwner,
          IfNoneMatch: "*",
          ...(this.kmsKeyId
            ? {
                ServerSideEncryption: "aws:kms" as const,
                SSEKMSKeyId: this.kmsKeyId,
              }
            : { ServerSideEncryption: "AES256" as const }),
        }),
      );
      const response = responseValue as { VersionId?: string };
      if (!response.VersionId)
        return permanent(
          "VERSION_ID_REQUIRED",
          "S3 did not return an immutable object version",
        );
      return {
        ok: true,
        value: objectFrom(input, storageKey, response.VersionId, scanReference),
      };
    } catch (error) {
      if (isPreconditionFailed(error)) {
        try {
          const winner = await this.head(storageKey);
          if (!winner)
            return providerError(
              new Error("Concurrent evidence upload winner is not readable"),
            );
          return existingEvidenceResult(winner, input, storageKey);
        } catch (headError) {
          return providerError(headError);
        }
      }
      return providerError(error);
    }
  }

  private async head(
    storageKey: string,
    versionId?: string,
  ): Promise<{
    VersionId?: string;
    Metadata?: Record<string, string>;
  } | null> {
    try {
      return (await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
          ...(versionId ? { VersionId: versionId } : {}),
          ExpectedBucketOwner: this.expectedBucketOwner,
        }),
      )) as { VersionId?: string; Metadata?: Record<string, string> };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  private async getByHash(
    hash: string,
    documentId: DocumentId,
    access: EvidenceAccessContext,
    versionId?: string,
  ): Promise<ProviderResult<EvidenceRead>> {
    const storageKey = keyFor(this.prefix, hash);
    try {
      const existing = await this.head(storageKey, versionId);
      if (!existing)
        return permanent("EVIDENCE_NOT_FOUND", "Evidence object not found");
      const resolvedVersion = existing.VersionId;
      if (!resolvedVersion || (versionId && versionId !== resolvedVersion))
        return permanent(
          "EVIDENCE_NOT_FOUND",
          "Evidence object version not found",
        );
      const metadata = parseS3Metadata(existing.Metadata);
      if (
        existing.Metadata?.immutable !== "true" ||
        !validCleanMetadata(metadata, hash)
      )
        return permanent(
          "EVIDENCE_NOT_CLEAN",
          "Stored evidence is not marked as malware-scanned and immutable",
        );
      if (
        !(await this.authorizer.authorize({ action: "read", access, metadata }))
      )
        return permanent(
          "EVIDENCE_ACCESS_DENIED",
          "Principal is not authorized for the evidence scope",
        );
      const responseValue = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
          VersionId: resolvedVersion,
          ExpectedBucketOwner: this.expectedBucketOwner,
          ChecksumMode: "ENABLED",
        }),
      );
      const response = responseValue as {
        Body?: { transformToByteArray(): Promise<Uint8Array> } | Uint8Array;
        VersionId?: string;
        Metadata?: Record<string, string>;
      };
      const bytes = await bodyToBytes(response.Body);
      if (sha256(bytes) !== hash)
        return permanent(
          "STORED_HASH_MISMATCH",
          "Downloaded evidence failed SHA-256 verification",
        );
      if (
        response.VersionId !== resolvedVersion ||
        stableJson(response.Metadata ?? {}) !==
          stableJson(existing.Metadata ?? {})
      )
        return permanent(
          "STORED_METADATA_INVALID",
          "Fetched evidence version metadata differs from its authorized metadata",
        );
      return {
        ok: true,
        value: {
          documentId,
          storageKey,
          versionId: resolvedVersion,
          metadata,
          scanReference: metadata.scanReference,
          bytes,
        },
      };
    } catch (error) {
      if (isNotFound(error))
        return permanent("EVIDENCE_NOT_FOUND", "Evidence object not found");
      return providerError(error);
    }
  }
}

interface StoredEvidence {
  object: EvidenceObject;
  bytes: Uint8Array;
}

export class FakeEvidenceStorageAdapter implements EvidenceStoragePort {
  private readonly objects = new Map<string, StoredEvidence>();
  private readonly documentHashes = new Map<DocumentId, string>();
  private readonly completedUploads = new Map<string, EvidenceObject>();
  private readonly pending = new Map<
    string,
    {
      input: Parameters<EvidenceStoragePort["createPresignedUpload"]>[0];
      bytes?: Uint8Array;
    }
  >();

  public constructor(
    private readonly scanner: MalwareScanner = new DeterministicMalwareScanner(),
    private readonly now: () => Date = () =>
      new Date("2026-07-31T16:00:00.000Z"),
    private readonly authorizer: EvidenceAccessAuthorizer = new ScopeMatchingEvidenceAccessAuthorizer(),
  ) {}

  public async putImmutable(
    input: Parameters<EvidenceStoragePort["putImmutable"]>[0],
  ): Promise<ProviderResult<EvidenceObject>> {
    const validation = validateEvidenceInput(input, this.now());
    if (validation) return validation;
    const scan = await this.scanner.scan(input);
    if (!scan.clean)
      return permanent("MALWARE_DETECTED", "Evidence malware scan failed");
    const existing = this.objects.get(input.contentHash);
    if (existing) {
      if (
        !metadataMatches(
          toS3Metadata(existing.object.metadata, existing.object.scanReference),
          input,
        )
      )
        return permanent(
          "IMMUTABLE_METADATA_CONFLICT",
          "Immutable metadata differs for an existing hash",
        );
      return { ok: true, value: existing.object, duplicate: true };
    }
    const documentId = documentIdFor(input.contentHash);
    const object: EvidenceObject = {
      documentId,
      storageKey: keyFor("evidence/sha256", input.contentHash),
      versionId: `version_${sha256Text(input.idempotencyKey).slice(0, 24)}`,
      metadata: Object.freeze({
        kind: input.kind,
        contentHash: input.contentHash,
        contentType: input.contentType,
        retainUntil: input.retainUntil,
        legalHold: input.legalHold ?? false,
        source: input.source,
        scope: input.scope,
        scanStatus: "clean",
        scanReference: scan.reference,
      }),
      scanReference: scan.reference,
    };
    this.objects.set(input.contentHash, { object, bytes: input.bytes.slice() });
    this.documentHashes.set(documentId, input.contentHash);
    return { ok: true, value: object };
  }

  public async get(
    input: Parameters<EvidenceStoragePort["get"]>[0],
  ): Promise<ProviderResult<EvidenceRead>> {
    const hash = this.documentHashes.get(input.documentId);
    const stored = hash ? this.objects.get(hash) : undefined;
    if (
      !stored ||
      hash !== input.contentHash ||
      (input.versionId && input.versionId !== stored.object.versionId)
    )
      return permanent("EVIDENCE_NOT_FOUND", "Evidence object not found");
    if (stored.object.metadata.scanStatus !== "clean")
      return permanent("EVIDENCE_NOT_CLEAN", "Evidence is not clean");
    if (
      !(await this.authorizer.authorize({
        action: "read",
        access: input.access,
        metadata: stored.object.metadata,
      }))
    )
      return permanent(
        "EVIDENCE_ACCESS_DENIED",
        "Principal is not authorized for the evidence scope",
      );
    const actual = sha256(stored.bytes);
    if (actual !== stored.object.metadata.contentHash)
      return permanent(
        "STORED_HASH_MISMATCH",
        "Stored bytes failed hash verification",
      );
    return {
      ok: true,
      value: { ...stored.object, bytes: stored.bytes.slice() },
    };
  }

  public createPresignedUpload(
    input: Parameters<EvidenceStoragePort["createPresignedUpload"]>[0],
  ): Promise<ProviderResult<PresignedEvidenceUpload>> {
    const validation = validateUploadInput(input, this.now());
    if (validation) return Promise.resolve(validation);
    const expiresInSeconds = input.expiresInSeconds ?? 900;
    const uploadId = `upload_${sha256Text(input.idempotencyKey).slice(0, 24)}`;
    const quarantineKey = `evidence/quarantine/${uploadId}`;
    this.pending.set(uploadId, { input });
    return Promise.resolve({
      ok: true,
      value: {
        uploadId,
        method: "PUT",
        url: `https://evidence.clockwork.test/upload/${uploadId}`,
        headers: Object.freeze({
          "content-type": input.contentType,
          "x-amz-checksum-sha256": Buffer.from(
            input.contentHash,
            "hex",
          ).toString("base64"),
        }),
        storageKey: quarantineKey,
        expiresAt: new Date(
          this.now().getTime() + expiresInSeconds * 1000,
        ).toISOString(),
      },
    });
  }

  public acceptPresignedUpload(uploadId: string, bytes: Uint8Array): void {
    const pending = this.pending.get(uploadId);
    if (!pending) throw new Error(`Unknown fake upload ${uploadId}`);
    pending.bytes = bytes.slice();
  }

  public async completePresignedUpload(
    input: Parameters<EvidenceStoragePort["completePresignedUpload"]>[0],
  ): Promise<ProviderResult<EvidenceObject>> {
    const completed = this.completedUploads.get(input.uploadId);
    if (completed) return { ok: true, value: completed, duplicate: true };
    const pending = this.pending.get(input.uploadId);
    if (!pending?.bytes)
      return permanent("UPLOAD_NOT_FOUND", "Uploaded bytes are unavailable");
    if (pending.bytes.byteLength !== pending.input.contentLength)
      return permanent("CONTENT_LENGTH_MISMATCH", "Upload length mismatch");
    const result = await this.putImmutable({
      kind: pending.input.kind,
      bytes: pending.bytes,
      contentHash: pending.input.contentHash,
      contentType: pending.input.contentType,
      retainUntil: pending.input.retainUntil,
      ...(pending.input.legalHold === undefined
        ? {}
        : { legalHold: pending.input.legalHold }),
      source: pending.input.source,
      scope: pending.input.scope,
      idempotencyKey: input.idempotencyKey,
    });
    if (result.ok) {
      this.pending.delete(input.uploadId);
      this.completedUploads.set(input.uploadId, result.value);
    }
    return result;
  }

  public async createPresignedDownload(
    input: Parameters<EvidenceStoragePort["createPresignedDownload"]>[0],
  ): Promise<ProviderResult<{ url: string; expiresAt: string }>> {
    const hash = this.documentHashes.get(input.documentId);
    const stored = hash ? this.objects.get(hash) : undefined;
    if (
      !stored ||
      hash !== input.contentHash ||
      stored.object.versionId !== input.versionId
    )
      return permanent("EVIDENCE_NOT_FOUND", "Evidence object not found");
    if (stored.object.metadata.scanStatus !== "clean")
      return permanent("EVIDENCE_NOT_CLEAN", "Evidence is not clean");
    if (
      !(await this.authorizer.authorize({
        action: "read",
        access: input.access,
        metadata: stored.object.metadata,
      }))
    )
      return permanent(
        "EVIDENCE_ACCESS_DENIED",
        "Principal is not authorized for the evidence scope",
      );
    const seconds = input.expiresInSeconds ?? 300;
    return {
      ok: true,
      value: {
        url: `https://evidence.clockwork.test/download/${input.documentId}?versionId=${encodeURIComponent(input.versionId)}`,
        expiresAt: new Date(
          this.now().getTime() + seconds * 1000,
        ).toISOString(),
      },
    };
  }
}

export function evidenceBucketIamPolicy(input: {
  bucketArn: string;
  prefix?: string;
  quarantinePrefix?: string;
}): Readonly<Record<string, unknown>> {
  const prefix = (input.prefix ?? "evidence/sha256")
    .replace(/^\//, "")
    .replace(/\/$/, "");
  const quarantinePrefix = (input.quarantinePrefix ?? "evidence/quarantine")
    .replace(/^\//, "")
    .replace(/\/$/, "");
  return Object.freeze({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "VerifyImmutableEvidenceBucket",
        Effect: "Allow",
        Action: [
          "s3:GetBucketVersioning",
          "s3:GetBucketObjectLockConfiguration",
        ],
        Resource: input.bucketArn,
      },
      {
        Sid: "ReadWriteVersionedEvidenceOnly",
        Effect: "Allow",
        Action: [
          "s3:PutObject",
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:GetObjectRetention",
          "s3:GetObjectLegalHold",
          "s3:PutObjectRetention",
          "s3:PutObjectLegalHold",
        ],
        Resource: `${input.bucketArn}/${prefix}/*`,
      },
      {
        Sid: "StageAndCleanEvidenceQuarantine",
        Effect: "Allow",
        Action: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
        Resource: `${input.bucketArn}/${quarantinePrefix}/*`,
      },
      {
        Sid: "DenyDestructiveEvidenceActions",
        Effect: "Deny",
        Action: [
          "s3:DeleteObject",
          "s3:DeleteObjectVersion",
          "s3:BypassGovernanceRetention",
        ],
        Resource: `${input.bucketArn}/${prefix}/*`,
      },
    ],
  });
}

function validateEvidenceInput(
  input: {
    bytes: Uint8Array;
    contentHash: string;
    contentType: string;
    retainUntil: string;
    scope: EvidenceScope;
  },
  now: Date,
): ProviderResult<never> | null {
  if (!/^[a-f0-9]{64}$/.test(input.contentHash))
    return permanent(
      "INVALID_CONTENT_HASH",
      "A lowercase SHA-256 hash is required",
    );
  if (sha256(input.bytes) !== input.contentHash)
    return permanent(
      "CONTENT_HASH_MISMATCH",
      "Evidence bytes do not match hash",
    );
  if (!input.contentType)
    return permanent("CONTENT_TYPE_REQUIRED", "Content type is required");
  if (!validScope(input.scope))
    return permanent(
      "EVIDENCE_SCOPE_REQUIRED",
      "A valid evidence scope is required",
    );
  if (Date.parse(input.retainUntil) <= now.getTime())
    return permanent("INVALID_RETENTION", "Retention must end in the future");
  return null;
}

function validateUploadInput(
  input: {
    contentHash: string;
    contentLength: number;
    contentType: string;
    retainUntil: string;
    scope: EvidenceScope;
  },
  now: Date,
): ProviderResult<never> | null {
  if (!/^[a-f0-9]{64}$/.test(input.contentHash))
    return permanent(
      "INVALID_CONTENT_HASH",
      "A lowercase SHA-256 hash is required",
    );
  if (!Number.isSafeInteger(input.contentLength) || input.contentLength <= 0)
    return permanent(
      "INVALID_CONTENT_LENGTH",
      "Content length must be positive",
    );
  if (!input.contentType)
    return permanent("CONTENT_TYPE_REQUIRED", "Content type is required");
  if (!validScope(input.scope))
    return permanent(
      "EVIDENCE_SCOPE_REQUIRED",
      "A valid evidence scope is required",
    );
  if (Date.parse(input.retainUntil) <= now.getTime())
    return permanent("INVALID_RETENTION", "Retention must end in the future");
  return null;
}

function toS3Metadata(
  input: {
    kind: EvidenceKind;
    contentHash: string;
    contentType: string;
    retainUntil: string;
    legalHold?: boolean;
    source: string;
    scope: EvidenceScope;
  },
  scanReference: string,
): Record<string, string> {
  return {
    kind: input.kind,
    "content-hash": input.contentHash,
    "content-type": input.contentType,
    "retain-until": input.retainUntil,
    "legal-hold": String(input.legalHold ?? false),
    source: input.source,
    "scope-kind": input.scope.kind,
    "scope-id": input.scope.id,
    "scan-status": "clean",
    "scan-reference": scanReference,
    immutable: "true",
  };
}

function parseS3Metadata(value?: Record<string, string>): EvidenceMetadata {
  const kind = value?.kind as EvidenceKind | undefined;
  return Object.freeze({
    kind: kind ?? "agreement",
    contentHash: value?.["content-hash"] ?? "",
    contentType: value?.["content-type"] ?? "application/octet-stream",
    retainUntil: value?.["retain-until"] ?? "",
    legalHold: value?.["legal-hold"] === "true",
    source: value?.source ?? "unknown",
    scope: {
      kind: (value?.["scope-kind"] ?? "internal") as EvidenceScope["kind"],
      id: value?.["scope-id"] ?? "",
    },
    scanStatus:
      value?.["scan-status"] === "clean"
        ? "clean"
        : value?.["scan-status"] === "quarantined"
          ? "quarantined"
          : "pending",
    scanReference: value?.["scan-reference"] ?? "",
  });
}

function metadataMatches(
  metadata: Record<string, string> | undefined,
  input: {
    kind: EvidenceKind;
    contentHash: string;
    contentType: string;
    retainUntil: string;
    legalHold?: boolean;
    source: string;
    scope: EvidenceScope;
  },
): boolean {
  const expected = toS3Metadata(input, metadata?.["scan-reference"] ?? "");
  return (
    metadata?.["scan-status"] === "clean" &&
    Object.entries(expected).every(([key, value]) => metadata?.[key] === value)
  );
}

function objectFrom(
  input: {
    kind: EvidenceKind;
    contentHash: string;
    contentType: string;
    retainUntil: string;
    legalHold?: boolean;
    source: string;
    scope: EvidenceScope;
  },
  storageKey: string,
  versionId: string,
  scanReference: string,
): EvidenceObject {
  return {
    documentId: documentIdFor(input.contentHash),
    storageKey,
    versionId,
    metadata: Object.freeze({
      kind: input.kind,
      contentHash: input.contentHash,
      contentType: input.contentType,
      retainUntil: input.retainUntil,
      legalHold: input.legalHold ?? false,
      source: input.source,
      scope: input.scope,
      scanStatus: "clean",
      scanReference,
    }),
    scanReference,
  };
}

function keyFor(prefix: string, hash: string): string {
  return `${prefix}/${hash.slice(0, 2)}/${hash}`;
}

function documentIdFor(hash: string): DocumentId {
  return ids.document.parse(
    `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
  );
}

async function bodyToBytes(
  body:
    { transformToByteArray(): Promise<Uint8Array> } | Uint8Array | undefined,
): Promise<Uint8Array> {
  if (!body) throw new Error("S3 response body is empty");
  if (body instanceof Uint8Array) return body;
  return body.transformToByteArray();
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "NotFound" || error.name === "NoSuchKey")
  );
}

function isPreconditionFailed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (("name" in error && error.name === "PreconditionFailed") ||
      ("$metadata" in error &&
        typeof error.$metadata === "object" &&
        error.$metadata !== null &&
        "httpStatusCode" in error.$metadata &&
        error.$metadata.httpStatusCode === 412))
  );
}

function validScope(scope: EvidenceScope): boolean {
  return (
    ["account", "organization", "internal"].includes(scope.kind) &&
    scope.id.trim().length > 0
  );
}

function validCleanMetadata(metadata: EvidenceMetadata, hash: string): boolean {
  return (
    metadata.contentHash === hash &&
    metadata.scanStatus === "clean" &&
    metadata.scanReference.length > 0 &&
    validScope(metadata.scope)
  );
}

function existingEvidenceResult(
  existing: { VersionId?: string; Metadata?: Record<string, string> },
  input: Parameters<EvidenceStoragePort["putImmutable"]>[0],
  storageKey: string,
): ProviderResult<EvidenceObject> {
  if (!metadataMatches(existing.Metadata, input))
    return permanent(
      "IMMUTABLE_METADATA_CONFLICT",
      "Existing content-addressed evidence has different immutable metadata",
    );
  if (!existing.VersionId)
    return permanent(
      "VERSION_ID_REQUIRED",
      "The evidence bucket did not return an immutable object version",
    );
  return {
    ok: true,
    value: objectFrom(
      input,
      storageKey,
      existing.VersionId,
      existing.Metadata?.["scan-reference"] ?? "",
    ),
    duplicate: true,
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJsonValue(item)]),
    );
  return value;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Text(value: string): string {
  return sha256(new TextEncoder().encode(value));
}

function permanent(code: string, message: string): ProviderResult<never> {
  return { ok: false, kind: "permanent", code, message };
}

function providerError(error: unknown): ProviderResult<never> {
  return {
    ok: false,
    kind: "transient",
    code: "S3_PROVIDER_ERROR",
    message: error instanceof Error ? error.message : "Unknown S3 error",
  };
}
