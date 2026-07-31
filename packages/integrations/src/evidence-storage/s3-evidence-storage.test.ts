import { createHash } from "node:crypto";

import {
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { IdempotencyKeySchema } from "@clockwork/contracts";
import { describe, expect, it } from "vitest";

import {
  DeterministicMalwareScanner,
  InMemoryPendingEvidenceUploadStore,
  S3EvidenceStorageAdapter,
  ScopeMatchingEvidenceAccessAuthorizer,
} from "./index";

interface MockObject {
  bytes: Uint8Array;
  metadata: Record<string, string>;
  versionId: string;
}

class MockS3Client {
  public readonly objects = new Map<string, MockObject>();
  public readonly commands: unknown[] = [];
  private version = 0;

  public async send(command: unknown): Promise<unknown> {
    await Promise.resolve();
    this.commands.push(command);
    if (command instanceof GetBucketVersioningCommand)
      return { Status: "Enabled" };
    if (command instanceof GetObjectLockConfigurationCommand)
      return { ObjectLockConfiguration: { ObjectLockEnabled: "Enabled" } };
    if (command instanceof HeadObjectCommand) {
      const object = this.objects.get(command.input.Key ?? "");
      if (
        !object ||
        (command.input.VersionId &&
          command.input.VersionId !== object.versionId)
      )
        throw namedError("NotFound");
      return { VersionId: object.versionId, Metadata: object.metadata };
    }
    if (command instanceof GetObjectCommand) {
      const object = this.objects.get(command.input.Key ?? "");
      if (
        !object ||
        (command.input.VersionId &&
          command.input.VersionId !== object.versionId)
      )
        throw namedError("NoSuchKey");
      return {
        Body: object.bytes.slice(),
        VersionId: object.versionId,
        Metadata: object.metadata,
      };
    }
    if (command instanceof PutObjectCommand) {
      const key = command.input.Key ?? "";
      if (command.input.IfNoneMatch === "*" && this.objects.has(key))
        throw namedError("PreconditionFailed");
      if (!(command.input.Body instanceof Uint8Array))
        throw new Error("Mocked sent PutObject requires bytes");
      const versionId = `version-${++this.version}`;
      this.objects.set(key, {
        bytes: command.input.Body.slice(),
        metadata: { ...(command.input.Metadata ?? {}) },
        versionId,
      });
      return { VersionId: versionId };
    }
    if (command instanceof DeleteObjectCommand) {
      this.objects.delete(command.input.Key ?? "");
      return {};
    }
    throw new Error(`Unexpected command ${String(command)}`);
  }

  public uploadFromPresignedCommand(
    command: PutObjectCommand,
    bytes: Uint8Array,
  ): void {
    this.objects.set(command.input.Key ?? "", {
      bytes: bytes.slice(),
      metadata: { ...(command.input.Metadata ?? {}) },
      versionId: `quarantine-${++this.version}`,
    });
  }
}

class MockPresigner {
  public readonly commands: unknown[] = [];

  public sign(command: unknown, expiresInSeconds: number): Promise<string> {
    this.commands.push(command);
    return Promise.resolve(
      `https://s3.example.test/signed?expires=${expiresInSeconds}`,
    );
  }
}

const now = new Date("2026-07-31T16:00:00.000Z");
const scope = { kind: "organization" as const, id: "org-s3-contract-303" };
const access = { principalId: "reader-303", scopes: [scope] };

function createAdapter(client: MockS3Client, presigner = new MockPresigner()) {
  return {
    adapter: new S3EvidenceStorageAdapter({
      client,
      presigner,
      scanner: new DeterministicMalwareScanner(),
      pendingUploads: new InMemoryPendingEvidenceUploadStore(),
      authorizer: new ScopeMatchingEvidenceAccessAuthorizer(),
      bucket: "clockwork-evidence",
      expectedBucketOwner: "123456789012",
      now: () => now,
    }),
    presigner,
  };
}

describe("S3 evidence storage adapter", () => {
  it("conditionally creates one immutable version for concurrent hash uploads", async () => {
    const client = new MockS3Client();
    const { adapter } = createAdapter(client);
    await adapter.validateBucketConfiguration();
    const bytes = new TextEncoder().encode("concurrent immutable evidence");
    const contentHash = hash(bytes);
    const input = {
      kind: "agreement" as const,
      bytes,
      contentHash,
      contentType: "application/pdf",
      retainUntil: "2033-07-31T16:00:00.000Z",
      source: "esign:concurrent",
      scope,
      idempotencyKey: IdempotencyKeySchema.parse("evidence:s3:concurrent:303"),
    };

    const [left, right] = await Promise.all([
      adapter.putImmutable(input),
      adapter.putImmutable(input),
    ]);
    expect(left.ok && right.ok).toBe(true);
    expect(
      [left, right].filter((result) => result.ok && result.duplicate),
    ).toHaveLength(1);
    const finalPuts = client.commands.filter(
      (command): command is PutObjectCommand =>
        command instanceof PutObjectCommand &&
        command.input.IfNoneMatch === "*",
    );
    expect(finalPuts).toHaveLength(2);
    expect(finalPuts[0]?.input).toMatchObject({
      ObjectLockMode: "COMPLIANCE",
      IfNoneMatch: "*",
    });
    if (!left.ok) throw new Error("expected immutable object");
    const getCountBeforeDeniedRead = client.commands.filter(
      (command) => command instanceof GetObjectCommand,
    ).length;
    await expect(
      adapter.get({
        documentId: left.value.documentId,
        contentHash,
        versionId: left.value.versionId,
        access: { principalId: "outsider", scopes: [] },
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "EVIDENCE_ACCESS_DENIED",
    });
    expect(
      client.commands.filter((command) => command instanceof GetObjectCommand),
    ).toHaveLength(getCountBeforeDeniedRead);
    await expect(
      adapter.get({
        documentId: left.value.documentId,
        contentHash,
        versionId: left.value.versionId,
        access,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("stages presigned bytes in quarantine, scans, then promotes and authorizes downloads", async () => {
    const client = new MockS3Client();
    const { adapter, presigner } = createAdapter(client);
    const bytes = new TextEncoder().encode("customer paper through quarantine");
    const contentHash = hash(bytes);
    const initiated = await adapter.createPresignedUpload({
      kind: "agreement",
      contentHash,
      contentLength: bytes.byteLength,
      contentType: "application/pdf",
      retainUntil: "2033-07-31T16:00:00.000Z",
      source: "customer-paper",
      scope,
      idempotencyKey: IdempotencyKeySchema.parse("evidence:s3:quarantine:303"),
    });
    if (!initiated.ok) throw new Error("expected upload URL");
    const uploadCommand = presigner.commands[0];
    expect(uploadCommand).toBeInstanceOf(PutObjectCommand);
    const quarantinePut = uploadCommand as PutObjectCommand;
    expect(quarantinePut.input.Key).toContain("evidence/quarantine/");
    expect(quarantinePut.input.ObjectLockMode).toBeUndefined();
    client.uploadFromPresignedCommand(quarantinePut, bytes);

    const completed = await adapter.completePresignedUpload({
      uploadId: initiated.value.uploadId,
      idempotencyKey: IdempotencyKeySchema.parse("evidence:s3:complete:303"),
    });
    expect(completed).toMatchObject({ ok: true });
    expect(client.objects.has(initiated.value.storageKey)).toBe(false);
    if (!completed.ok) throw new Error("expected promotion");
    await expect(
      adapter.completePresignedUpload({
        uploadId: initiated.value.uploadId,
        idempotencyKey: IdempotencyKeySchema.parse(
          "evidence:s3:complete-replay:303",
        ),
      }),
    ).resolves.toMatchObject({ ok: true, duplicate: true });

    await expect(
      adapter.createPresignedDownload({
        documentId: completed.value.documentId,
        contentHash,
        versionId: completed.value.versionId,
        access: { principalId: "outsider", scopes: [] },
      }),
    ).resolves.toMatchObject({ ok: false, code: "EVIDENCE_ACCESS_DENIED" });
    await expect(
      adapter.createPresignedDownload({
        documentId: completed.value.documentId,
        contentHash,
        versionId: completed.value.versionId,
        access,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("never promotes malware from quarantine into an Object Lock key", async () => {
    const client = new MockS3Client();
    const { adapter, presigner } = createAdapter(client);
    const bytes = new TextEncoder().encode(
      "EICAR-STANDARD-ANTIVIRUS-TEST-FILE",
    );
    const contentHash = hash(bytes);
    const initiated = await adapter.createPresignedUpload({
      kind: "agreement",
      contentHash,
      contentLength: bytes.byteLength,
      contentType: "application/pdf",
      retainUntil: "2033-07-31T16:00:00.000Z",
      source: "untrusted",
      scope,
      idempotencyKey: IdempotencyKeySchema.parse("evidence:s3:malware:303"),
    });
    if (!initiated.ok) throw new Error("expected quarantine URL");
    client.uploadFromPresignedCommand(
      presigner.commands[0] as PutObjectCommand,
      bytes,
    );

    await expect(
      adapter.completePresignedUpload({
        uploadId: initiated.value.uploadId,
        idempotencyKey: IdempotencyKeySchema.parse(
          "evidence:s3:malware-complete:303",
        ),
      }),
    ).resolves.toMatchObject({ ok: false, code: "MALWARE_DETECTED" });
    expect(
      [...client.objects.keys()].some((key) =>
        key.includes(`/sha256/${contentHash.slice(0, 2)}/${contentHash}`),
      ),
    ).toBe(false);
    expect(client.objects.has(initiated.value.storageKey)).toBe(true);
  });
});

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function namedError(name: string): Error {
  return Object.assign(new Error(name), { name });
}
