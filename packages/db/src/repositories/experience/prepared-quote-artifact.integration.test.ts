import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { uuidV7 } from "@clockwork/contracts";

import { createRuntimeDatabase } from "../../client";
import {
  withAuthorizedTransaction,
  withInternalTransaction,
} from "../../transaction";
import { findPreparedQuoteArtifact } from "./prepared-quote-artifact";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";

const audienceAccountId = "10000000-0000-4000-8000-000000000001";
const otherAccountId = "10000000-0000-4000-8000-000000000002";
const requestedBy = "20000000-0000-4000-8000-000000000002";
const storedQuoteId = uuidV7();
const pendingQuoteId = uuidV7();
const storedRequestId = uuidV7();
const pendingRequestId = uuidV7();
const documentId = uuidV7();
const suffix = storedQuoteId.replaceAll("-", "").slice(0, 12);

const runtime = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 3,
  role: "clockwork_service",
  ssl: false,
});

function hash(seed: string): string {
  return createHash("sha256").update(`${suffix}:${seed}`).digest("hex");
}

function tenantContext(accountId: string) {
  return {
    userId: requestedBy as never,
    accountIds: [accountId],
    roles: ["owner"] as const,
    isInternalStaff: false,
    requestId: `prepared-quote-artifact-${suffix}`,
  };
}

beforeAll(async () => {
  const definition = {
    kind: "direct_quote",
    displayDocumentId: `Q-${storedQuoteId}`,
    documentVersion: "1",
  };
  await withInternalTransaction(
    runtime.db,
    `seed-prepared-quote-artifact-${suffix}`,
    async (transaction) => {
      await transaction.execute(sql`
        insert into public.documents (
          id, account_id, kind, storage_key, content_hash, mime_type,
          byte_length, object_lock_mode, retain_until, legal_hold,
          storage_version_id
        ) values (
          ${documentId}::uuid, ${audienceAccountId}::uuid, 'direct_quote',
          ${`quotes/${suffix}.pdf`}, ${hash("document")}, 'application/pdf',
          4096, 'COMPLIANCE', now() + interval '7 years', false,
          ${`version-${suffix}`}
        )
      `);
      await transaction.execute(sql`
        insert into public.core_commercial_artifact_requests (
          id, subject_type, subject_id, commercial_account_id,
          audience_account_id, audience, document_kind, source_definition,
          source_hash, request_hash, retain_until, status, document_id,
          content_hash, storage_version_id, requested_by
        ) values (
          ${storedRequestId}::uuid, 'quote', ${storedQuoteId}::uuid,
          ${audienceAccountId}::uuid, ${audienceAccountId}::uuid,
          'end_client', 'direct_quote', ${JSON.stringify(definition)}::jsonb,
          ${hash("source")}, ${hash("request")}, now() + interval '7 years',
          'stored', ${documentId}::uuid, ${hash("document")},
          ${`version-${suffix}`}, ${requestedBy}::uuid
        )
      `);
      await transaction.execute(sql`
        insert into public.core_commercial_artifact_requests (
          id, subject_type, subject_id, commercial_account_id,
          audience_account_id, audience, document_kind, source_definition,
          source_hash, request_hash, retain_until, status, requested_by
        ) values (
          ${pendingRequestId}::uuid, 'quote', ${pendingQuoteId}::uuid,
          ${audienceAccountId}::uuid, ${audienceAccountId}::uuid,
          'end_client', 'direct_quote', ${JSON.stringify(definition)}::jsonb,
          ${hash("pending-source")}, ${hash("pending-request")},
          now() + interval '7 years', 'requested', ${requestedBy}::uuid
        )
      `);
    },
  );
});

afterAll(async () => {
  await runtime.client.end();
});

function read(accountId: string, quoteId: string) {
  return withAuthorizedTransaction(
    runtime.db,
    tenantContext(accountId),
    { secret: authorizationSecret },
    (transaction) => findPreparedQuoteArtifact(transaction, { quoteId }),
  );
}

describe("prepared quote artifact", () => {
  it("returns the stored end-client document to its audience account", async () => {
    await expect(read(audienceAccountId, storedQuoteId)).resolves.toEqual({
      documentId,
      quoteId: storedQuoteId,
      artifactId: storedRequestId,
    });
  });

  it("does not treat an unfinished render as issuance evidence", async () => {
    await expect(read(audienceAccountId, pendingQuoteId)).resolves.toBeNull();
  });

  it("lets row-level security hide another account's artifact", async () => {
    await expect(read(otherAccountId, storedQuoteId)).resolves.toBeNull();
  });

  it("refuses a non-UUID before querying", async () => {
    await expect(read(audienceAccountId, "quote-1")).rejects.toThrow();
  });
});
