import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";

import type { ProviderJsonTransport } from "../provider-transport";
import { HttpMigrationSnapshotSource } from "./source";

const bytes = new TextEncoder().encode("approved-customer-snapshot");
const snapshotHash = createHash("sha256").update(bytes).digest("hex");
const evidenceHash = "a".repeat(64);

function transport(
  overrides: Readonly<Record<string, unknown>> = {},
): ProviderJsonTransport {
  return {
    request<T>(input: {
      operation: string;
      path: string;
      body: Readonly<Record<string, unknown>>;
      response: ZodType<T>;
      idempotencyKey?: string;
    }): Promise<T> {
      return Promise.resolve(
        input.response.parse({
          sourceBytesBase64: Buffer.from(bytes).toString("base64"),
          sourceSnapshotHash: snapshotHash,
          sourceRecords: [
            {
              legacyAccountId: "legacy-1",
              disposition: "review",
              matchedAccountId: null,
              matchReasons: [],
              candidateAccountIds: [],
              reacceptanceRequired: true,
              idempotencyKey: "migration:legacy:123456",
            },
          ],
          snapshotAccessAuthorization: {
            actorId: "migration-operator-1",
            authorized: true,
            authorizedAt: "2026-07-31T16:00:00.000Z",
            evidenceHash,
            recentAuthentication: {
              authenticatedAt: "2026-07-31T15:55:00.000Z",
              evidenceHash: "b".repeat(64),
            },
          },
          windowId: "migration-window-2026-08",
          ...overrides,
        }),
      );
    },
  };
}

function source(providerTransport = transport(), allowExecute = false) {
  return new HttpMigrationSnapshotSource({
    transport: providerTransport,
    windowId: "migration-window-2026-08",
    authorizedActorId: "migration-operator-1",
    accessEvidenceHash: evidenceHash,
    allowExecute,
    maxBytes: 1000,
    maxRecords: 10,
  });
}

describe("HttpMigrationSnapshotSource", () => {
  it("returns only a hash-bound, approval-scoped real snapshot", async () => {
    await expect(
      source().load({
        sourceSnapshotHash: snapshotHash,
        executionMode: "rehearsal",
        requestId: "migration-request-1",
      }),
    ).resolves.toMatchObject({
      sourceBytes: bytes,
      sourceRecords: [{ legacyAccountId: "legacy-1" }],
      snapshotAccessAuthorization: {
        actorId: "migration-operator-1",
        evidenceHash,
      },
    });
  });

  it("rejects source substitution and a closed execution window", async () => {
    await expect(
      source(transport({ sourceSnapshotHash: "c".repeat(64) })).load({
        sourceSnapshotHash: snapshotHash,
        executionMode: "rehearsal",
        requestId: "migration-request-2",
      }),
    ).rejects.toThrow("MIGRATION_SOURCE_SNAPSHOT_MISMATCH");
    await expect(
      source().load({
        sourceSnapshotHash: snapshotHash,
        executionMode: "execute",
        requestId: "migration-request-3",
      }),
    ).rejects.toThrow("MIGRATION_SOURCE_EXECUTION_NOT_ACTIVATED");
  });
});
