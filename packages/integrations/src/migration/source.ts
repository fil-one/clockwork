import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import type {
  DiscoveryRecord,
  SnapshotAccessAuthorization,
} from "@clockwork/domain/lifecycle";
import { z } from "zod";

import type { ProviderJsonTransport } from "../provider-transport";

const DiscoveryRecordSchema: z.ZodType<DiscoveryRecord> = z.object({
  legacyAccountId: z.string().min(1),
  disposition: z.enum(["create", "attach", "review", "skip"]),
  matchedAccountId: z.string().nullable(),
  matchReasons: z.array(z.string()),
  candidateAccountIds: z.array(z.string()),
  reacceptanceRequired: z.boolean(),
  idempotencyKey: z.string().min(16),
});

const SnapshotAuthorizationSchema: z.ZodType<SnapshotAccessAuthorization> =
  z.object({
    actorId: z.string().min(1),
    authorized: z.boolean(),
    authorizedAt: z.string().datetime({ offset: true }),
    evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
    recentAuthentication: z.object({
      authenticatedAt: z.string().datetime({ offset: true }),
      evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  });

const SnapshotResponseSchema = z.object({
  sourceBytesBase64: z.string().min(1),
  sourceSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRecords: z.array(DiscoveryRecordSchema),
  snapshotAccessAuthorization: SnapshotAuthorizationSchema,
  windowId: z.string().min(8),
});

export interface MigrationSnapshotSource {
  load(input: {
    sourceSnapshotHash: string;
    executionMode: "discovery" | "rehearsal" | "execute";
    requestId: string;
  }): Promise<{
    sourceBytes: Uint8Array;
    sourceRecords: readonly DiscoveryRecord[];
    snapshotAccessAuthorization: SnapshotAccessAuthorization;
  }>;
}

export interface HttpMigrationSnapshotSourceOptions {
  transport: ProviderJsonTransport;
  windowId: string;
  authorizedActorId: string;
  accessEvidenceHash: string;
  allowExecute: boolean;
  maxBytes?: number;
  maxRecords?: number;
}

/**
 * Live existing-customer snapshot boundary. The caller pins the expected hash,
 * activation window, access actor, and immutable approval evidence; the source
 * cannot substitute any of them in its response.
 */
export class HttpMigrationSnapshotSource implements MigrationSnapshotSource {
  private readonly maxBytes: number;
  private readonly maxRecords: number;

  public constructor(
    private readonly options: HttpMigrationSnapshotSourceOptions,
  ) {
    if (!options.windowId.trim()) throw new Error("MIGRATION_WINDOW_REQUIRED");
    if (!options.authorizedActorId.trim())
      throw new Error("MIGRATION_ACCESS_ACTOR_REQUIRED");
    if (!/^[a-f0-9]{64}$/.test(options.accessEvidenceHash))
      throw new Error("MIGRATION_ACCESS_EVIDENCE_INVALID");
    this.maxBytes = options.maxBytes ?? 750_000;
    this.maxRecords = options.maxRecords ?? 10_000;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1)
      throw new Error("MIGRATION_SOURCE_BYTE_LIMIT_INVALID");
    if (!Number.isSafeInteger(this.maxRecords) || this.maxRecords < 1)
      throw new Error("MIGRATION_SOURCE_RECORD_LIMIT_INVALID");
  }

  public async load(input: {
    sourceSnapshotHash: string;
    executionMode: "discovery" | "rehearsal" | "execute";
    requestId: string;
  }) {
    if (!/^[a-f0-9]{64}$/.test(input.sourceSnapshotHash))
      throw new Error("MIGRATION_SOURCE_HASH_INVALID");
    if (input.executionMode === "execute" && !this.options.allowExecute)
      throw new Error("MIGRATION_SOURCE_EXECUTION_NOT_ACTIVATED");
    const response = await this.options.transport.request({
      operation: "migration.snapshot.load",
      path: "/v1/migration/snapshots/load",
      body: {
        sourceSnapshotHash: input.sourceSnapshotHash,
        executionMode: input.executionMode,
        windowId: this.options.windowId,
        requestId: input.requestId,
      },
      response: SnapshotResponseSchema,
      idempotencyKey: `migration:${input.sourceSnapshotHash}:${input.executionMode}`,
    });
    const sourceBytes = new Uint8Array(
      Buffer.from(response.sourceBytesBase64, "base64"),
    );
    if (sourceBytes.byteLength > this.maxBytes)
      throw new Error("MIGRATION_SOURCE_BYTE_LIMIT_EXCEEDED");
    if (response.sourceRecords.length > this.maxRecords)
      throw new Error("MIGRATION_SOURCE_RECORD_LIMIT_EXCEEDED");
    const actualHash = createHash("sha256").update(sourceBytes).digest("hex");
    if (
      response.sourceSnapshotHash !== input.sourceSnapshotHash ||
      actualHash !== input.sourceSnapshotHash
    )
      throw new Error("MIGRATION_SOURCE_SNAPSHOT_MISMATCH");
    if (
      response.windowId !== this.options.windowId ||
      response.snapshotAccessAuthorization.actorId !==
        this.options.authorizedActorId ||
      response.snapshotAccessAuthorization.evidenceHash !==
        this.options.accessEvidenceHash ||
      !response.snapshotAccessAuthorization.authorized
    )
      throw new Error("MIGRATION_SOURCE_AUTHORIZATION_MISMATCH");
    return {
      sourceBytes,
      sourceRecords: response.sourceRecords,
      snapshotAccessAuthorization: response.snapshotAccessAuthorization,
    };
  }
}
