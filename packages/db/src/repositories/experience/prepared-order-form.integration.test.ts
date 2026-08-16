import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { uuidV7 } from "@clockwork/contracts";

import { createRuntimeDatabase } from "../../client";
import {
  withAuthorizedTransaction,
  withInternalTransaction,
} from "../../transaction";
import { findPreparedOrderForm } from "./prepared-order-form";

/**
 * The bridge between the two acceptance passes, driven against the live
 * database under a real signed authorization context.
 *
 * What it has to prove is not that a query returns a row. It is that the row
 * exists in the window where the surface needs it -- after `prepare_artifact`
 * and before `create` -- and that the tenant reading it sees only artifacts
 * addressed to an account they hold. Both are decided by row-level security
 * (`core_commercial_artifact_select`, migration 000931) rather than by any
 * predicate in application code, so a test that ran on the service pool would
 * prove nothing at all about either.
 */
const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";

const audienceAccountId = "10000000-0000-4000-8000-000000000001";
const otherAccountId = "10000000-0000-4000-8000-000000000002";
const requestedBy = "20000000-0000-4000-8000-000000000002";

const storedOrderId = uuidV7();
const pendingOrderId = uuidV7();
const storedRequestId = uuidV7();
const pendingRequestId = uuidV7();
const documentId = uuidV7();
const suffix = storedOrderId.replaceAll("-", "").slice(0, 12);

const runtime = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 3,
  role: "clockwork_service",
  ssl: false,
});

const definition = {
  kind: "order_form",
  displayDocumentId: `ORD-${storedOrderId}`,
  documentVersion: "1",
};

/** Unique per run: `documents.content_hash` is unique across the table. */
function hash(seed: string): string {
  return createHash("sha256").update(`${suffix}:${seed}`).digest("hex");
}

/** The reader the acceptance surface runs as. */
function tenantContext(accountId: string) {
  return {
    userId: requestedBy as never,
    accountIds: [accountId],
    roles: ["owner"] as const,
    isInternalStaff: false,
    requestId: `prepared-order-form-${suffix}`,
  };
}

beforeAll(async () => {
  await withInternalTransaction(
    runtime.db,
    `seed-prepared-order-form-${suffix}`,
    async (transaction) => {
      await transaction.execute(sql`
        insert into public.documents (
          id, account_id, kind, storage_key, content_hash, mime_type,
          byte_length, object_lock_mode, retain_until, legal_hold,
          storage_version_id
        ) values (
          ${documentId}::uuid, ${audienceAccountId}::uuid, 'order_form',
          ${`order-forms/${suffix}.pdf`}, ${hash("a")}, 'application/pdf',
          4096, 'COMPLIANCE', now() + interval '7 years', false,
          ${`version-${suffix}`}
        )
      `);
      // Two requests, in the two states the renderer moves through. Only the
      // stored one is an answer; the requested one is the window this read
      // exists to sit inside.
      await transaction.execute(sql`
        insert into public.core_commercial_artifact_requests (
          id, subject_type, subject_id, commercial_account_id,
          audience_account_id, audience, document_kind, source_definition,
          source_hash, request_hash, retain_until, status, document_id,
          content_hash, storage_version_id, requested_by
        ) values (
          ${storedRequestId}::uuid, 'order', ${storedOrderId}::uuid,
          ${audienceAccountId}::uuid, ${audienceAccountId}::uuid,
          'end_client', 'order_form', ${JSON.stringify(definition)}::jsonb,
          ${hash("b")}, ${hash("c")}, now() + interval '7 years', 'stored',
          ${documentId}::uuid, ${hash("a")}, ${`version-${suffix}`},
          ${requestedBy}::uuid
        )
      `);
      await transaction.execute(sql`
        insert into public.core_commercial_artifact_requests (
          id, subject_type, subject_id, commercial_account_id,
          audience_account_id, audience, document_kind, source_definition,
          source_hash, request_hash, retain_until, status, requested_by
        ) values (
          ${pendingRequestId}::uuid, 'order', ${pendingOrderId}::uuid,
          ${audienceAccountId}::uuid, ${audienceAccountId}::uuid,
          'end_client', 'order_form', ${JSON.stringify(definition)}::jsonb,
          ${hash("d")}, ${hash("e")}, now() + interval '7 years', 'requested',
          ${requestedBy}::uuid
        )
      `);
    },
  );
});

/**
 * The seeded rows are deliberately left behind.
 *
 * `protect_commercial_artifact_request` raises 55000 on any delete -- these
 * rows are the evidence a signed document was produced from a given source, so
 * the table is append-only by construction -- and the document they point at
 * cannot be deleted either while they reference it. Every identifier above is
 * minted per run, so repeated runs neither collide nor accumulate meaning.
 */
afterAll(async () => {
  await runtime.client.end();
});

function read(accountId: string, orderId: string) {
  return withAuthorizedTransaction(
    runtime.db,
    tenantContext(accountId),
    { secret: authorizationSecret },
    (transaction) => findPreparedOrderForm(transaction, { orderId }),
  );
}

describe("prepared order form", () => {
  /**
   * The window the whole bridge depends on. No `public.orders` row exists for
   * this identifier -- `prepare_artifact` writes none -- so nothing on the
   * orders projection can answer, and this is the only place the document and
   * the order it was prepared for are bound together.
   */
  it("is readable by the audience account before any order row exists", async () => {
    const orderRows = await withInternalTransaction(
      runtime.db,
      `assert-no-order-${suffix}`,
      (transaction) =>
        transaction.execute(
          sql`select id from public.orders where id = ${storedOrderId}::uuid`,
        ),
    );
    expect(orderRows).toHaveLength(0);

    await expect(read(audienceAccountId, storedOrderId)).resolves.toEqual({
      documentId,
      orderId: storedOrderId,
    });
  });

  it("answers nothing while the renderer has not stored the form", async () => {
    await expect(read(audienceAccountId, pendingOrderId)).resolves.toBeNull();
  });

  /**
   * Not an application predicate: this function adds no account test at all.
   * `core_commercial_artifact_select` is what makes another tenant's order
   * form invisible, and that is what is being exercised here.
   */
  it("is invisible to an account the artifact is not addressed to", async () => {
    await expect(read(otherAccountId, storedOrderId)).resolves.toBeNull();
  });

  it("refuses an identifier that is not a UUID before it reaches the query", async () => {
    await expect(read(audienceAccountId, "order-1")).rejects.toThrow();
  });
});
