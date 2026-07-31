import { createHash } from "node:crypto";

import { IdempotencyKeySchema } from "@clockwork/contracts";
import { describe, expect, it } from "vitest";

import { evidenceBucketIamPolicy, FakeEvidenceStorageAdapter } from "./index";

const scope = { kind: "organization" as const, id: "org-contract-303" };
const access = { principalId: "account-contract-303", scopes: [scope] };

describe("immutable evidence storage contract", () => {
  it("uses SHA-256 addressing, immutable versions, retention, and verified downloads", async () => {
    const storage = new FakeEvidenceStorageAdapter();
    const bytes = new TextEncoder().encode("executed agreement evidence");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const input = {
      kind: "agreement" as const,
      bytes,
      contentHash,
      contentType: "application/pdf",
      retainUntil: "2033-07-31T16:00:00.000Z",
      legalHold: true,
      source: "esign:env_contract_303",
      scope,
      idempotencyKey: IdempotencyKeySchema.parse("evidence:put:contract:303"),
    };
    const first = await storage.putImmutable(input);
    const replay = await storage.putImmutable(input);
    expect(first.ok && replay.ok).toBe(true);
    if (!first.ok || !replay.ok) throw new Error("expected evidence");
    expect(replay.duplicate).toBe(true);
    expect(replay.value.versionId).toBe(first.value.versionId);
    expect(first.value.storageKey).toContain(contentHash);
    expect(first.value.metadata).toMatchObject({
      contentHash,
      legalHold: true,
      retainUntil: input.retainUntil,
    });
    const read = await storage.get({
      documentId: first.value.documentId,
      contentHash,
      versionId: first.value.versionId,
      access,
    });
    expect(read.ok && new TextDecoder().decode(read.value.bytes)).toBe(
      "executed agreement evidence",
    );
    await expect(
      storage.get({
        documentId: first.value.documentId,
        contentHash,
        versionId: first.value.versionId,
        access: {
          principalId: "other-account",
          scopes: [{ kind: "organization", id: "other-org" }],
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "EVIDENCE_ACCESS_DENIED",
    });
  });

  it("scans direct and presigned uploads before making them usable", async () => {
    const storage = new FakeEvidenceStorageAdapter();
    const bytes = new TextEncoder().encode("customer paper upload");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const initiated = await storage.createPresignedUpload({
      kind: "agreement",
      contentHash,
      contentLength: bytes.byteLength,
      contentType: "application/pdf",
      retainUntil: "2033-07-31T16:00:00.000Z",
      source: "customer-paper",
      scope,
      idempotencyKey: IdempotencyKeySchema.parse(
        "evidence:upload:contract:303",
      ),
    });
    if (!initiated.ok) throw new Error("expected upload");
    expect(initiated.value.storageKey).toContain("evidence/quarantine/");
    expect(initiated.value.headers).not.toHaveProperty(
      "x-amz-object-lock-mode",
    );
    storage.acceptPresignedUpload(initiated.value.uploadId, bytes);
    await expect(
      storage.completePresignedUpload({
        uploadId: initiated.value.uploadId,
        idempotencyKey: IdempotencyKeySchema.parse(
          "evidence:complete:contract:303",
        ),
      }),
    ).resolves.toMatchObject({ ok: true });

    const malware = new TextEncoder().encode(
      "EICAR-STANDARD-ANTIVIRUS-TEST-FILE",
    );
    await expect(
      storage.putImmutable({
        kind: "agreement",
        bytes: malware,
        contentHash: createHash("sha256").update(malware).digest("hex"),
        contentType: "application/pdf",
        retainUntil: "2033-07-31T16:00:00.000Z",
        source: "untrusted-upload",
        scope,
        idempotencyKey: IdempotencyKeySchema.parse(
          "evidence:malware:contract:303",
        ),
      }),
    ).resolves.toMatchObject({ ok: false, code: "MALWARE_DETECTED" });
  });

  it("publishes a least-privilege policy with an explicit destructive deny", () => {
    const policy = JSON.stringify(
      evidenceBucketIamPolicy({ bucketArn: "arn:aws:s3:::clockwork-evidence" }),
    );
    expect(policy).toContain("s3:GetObjectVersion");
    expect(policy).toContain("s3:PutObjectRetention");
    expect(policy).toContain("s3:PutObjectLegalHold");
    expect(policy).toContain("evidence/quarantine");
    expect(policy).toContain("s3:DeleteObjectVersion");
    expect(policy).toContain('"Effect":"Deny"');
    expect(policy).not.toContain("s3:*");
  });
});
