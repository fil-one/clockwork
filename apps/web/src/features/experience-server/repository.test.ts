import type { SessionClaims } from "@clockwork/api";
import type { RuntimeDatabase } from "@clockwork/db";
import { beforeEach, describe, expect, it } from "vitest";

import { DatabaseExperienceRepository } from "./repository";
import type { RenderRequestRecord } from "./repository";

const accountId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000002";
const projectionId = "50000000-0000-4000-8000-000000000001";
const aggregateId = "60000000-0000-4000-8000-000000000001";
const actionId = "70000000-0000-4000-8000-000000000001";
const auditEventId = "71000000-0000-4000-8000-000000000001";
const outboxMessageId = "72000000-0000-4000-8000-000000000001";

const session: SessionClaims = {
  userId,
  organizationId: "30000000-0000-4000-8000-000000000001",
  accountIds: [accountId],
  roles: ["owner"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

const partnerSession: SessionClaims = {
  ...session,
  roles: ["partner_admin"],
};

function database(results: unknown[][]): RuntimeDatabase {
  const transaction = {
    execute: () => Promise.resolve(results.shift() ?? []),
  };
  return {
    transaction: async <T>(
      operation: (value: typeof transaction) => Promise<T>,
    ) => operation(transaction),
  } as unknown as RuntimeDatabase;
}

function actionRow() {
  return {
    id: actionId,
    projection_id: projectionId,
    aggregate_type: "quote",
    aggregate_id: aggregateId,
    action: "accept",
    expected_version: 3,
    status: "queued",
    created_at: "2026-07-31T12:00:00.000Z",
    request_payload: { accepted: true },
    audit_event_id: auditEventId,
    outbox_message_id: outboxMessageId,
  };
}

function actionInput() {
  return {
    session,
    projectionId,
    recordKey: "Q-2026-0001",
    audience: "customer" as const,
    channel: "quotes" as const,
    accountId,
    action: "accept",
    expectedVersion: 3,
    idempotencyKey: "idempotency-key-000000000001",
    payload: { accepted: true },
    requestId: "request-12345678",
  };
}

function failedRenderRequest(): RenderRequestRecord {
  return {
    id: "7b000000-0000-4000-8000-000000000001",
    accountId,
    audience: "customer",
    audienceAccountId: accountId,
    subjectType: "quote",
    subjectId: aggregateId,
    kind: "direct_quote",
    input: {},
    sourceHash: "a".repeat(64),
    sourceVersion: "quote:1",
    retainUntil: "2033-07-31T12:00:00.000Z",
    status: "failed",
    version: 7,
  };
}

beforeEach(() => {
  process.env.AUTHORIZATION_CONTEXT_SECRET =
    "authorization-secret-that-is-at-least-32-bytes";
});

describe("projection action persistence", () => {
  it("replays the same bound request with its durable audit/outbox join IDs", async () => {
    const runtime = database([[], [], [], [actionRow()]]);
    const repository = new DatabaseExperienceRepository(runtime, database([]));
    await expect(
      repository.queueProjectionAction(actionInput()),
    ).resolves.toEqual({
      id: actionId,
      projectionId,
      aggregateType: "quote",
      aggregateId,
      action: "accept",
      expectedVersion: 3,
      status: "queued",
      resultReference: null,
      resultCode: null,
      authoritativeVersion: null,
      commandReplayed: null,
      createdAt: "2026-07-31T12:00:00.000Z",
      completedAt: null,
      auditEventId,
      outboxMessageId,
    });
  });

  it("rejects reuse of an idempotency key with a different binding", async () => {
    const runtime = database([[], [], [], [], [{ id: actionId }]]);
    const repository = new DatabaseExperienceRepository(runtime, database([]));
    await expect(
      repository.queueProjectionAction(actionInput()),
    ).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
    });
  });

  it("rejects a stale optimistic version before inserting", async () => {
    const runtime = database([
      [],
      [],
      [],
      [],
      [],
      [
        {
          id: projectionId,
          aggregate_type: "quote",
          aggregate_id: aggregateId,
          command_resource: "core:quotes",
          subject_account_id: accountId,
          source_aggregate_version: 4,
        },
      ],
    ]);
    const repository = new DatabaseExperienceRepository(runtime, database([]));
    await expect(
      repository.queueProjectionAction(actionInput()),
    ).rejects.toMatchObject({
      status: 409,
      code: "VERSION_CONFLICT",
    });
  });

  it("reads a terminal receipt through the actor and projection scope", async () => {
    const terminal = {
      ...actionRow(),
      status: "applied",
      result_reference: "core:quotes:result:version:4",
      result_code: "PORTAL_ACTION_APPLIED",
      authoritative_version: 4,
      command_replayed: false,
      completed_at: "2026-07-31T12:00:02.000Z",
    };
    const repository = new DatabaseExperienceRepository(
      database([[], [], [], [terminal]]),
      database([]),
    );
    await expect(
      repository.getProjectionAction({
        session,
        audience: "customer",
        channel: "quotes",
        accountId,
        recordKey: "Q-2026-0001",
        actionRequestId: actionId,
        requestId: "receipt-request-12345678",
      }),
    ).resolves.toMatchObject({
      id: actionId,
      status: "applied",
      resultCode: "PORTAL_ACTION_APPLIED",
      authoritativeVersion: 4,
      commandReplayed: false,
      completedAt: "2026-07-31T12:00:02.000Z",
    });
  });
});

describe("e-sign return persistence", () => {
  const returnRow = {
    correlation_id: "73000000-0000-4000-8000-000000000001",
    envelope_id: "74000000-0000-4000-8000-000000000001",
    agreement_draft_id: "75000000-0000-4000-8000-000000000001",
    document_id: "76000000-0000-4000-8000-000000000001",
    expires_at: "2026-07-31T13:00:00.000Z",
    state: "completed",
    signed_pdf_document_id: "77000000-0000-4000-8000-000000000001",
    completion_certificate_document_id: "78000000-0000-4000-8000-000000000001",
    updated_at: "2026-07-31T12:05:00.000Z",
  };

  it("reads completion from the joined server envelope and records a receipt", async () => {
    const repository = new DatabaseExperienceRepository(
      database([[], [], [], [returnRow], []]),
      database([]),
    );
    await expect(
      repository.readEsignReturn({
        session,
        opaqueState: "opaque-state-not-a-query-status",
        now: new Date("2026-07-31T12:10:00.000Z"),
        requestId: "request-12345678",
      }),
    ).resolves.toMatchObject({
      state: "completed",
      signedDocumentId: returnRow.signed_pdf_document_id,
    });
  });

  it("rejects altered state/hash/envelope correlations as not found", async () => {
    const repository = new DatabaseExperienceRepository(
      database([[], [], [], []]),
      database([]),
    );
    await expect(
      repository.readEsignReturn({
        session,
        opaqueState: "altered",
        now: new Date("2026-07-31T12:10:00.000Z"),
        requestId: "request-12345678",
      }),
    ).rejects.toMatchObject({ status: 404, code: "ESIGN_RETURN_NOT_FOUND" });
  });

  it("maps out-of-order provider state to pending rather than success", async () => {
    const repository = new DatabaseExperienceRepository(
      database([
        [],
        [],
        [],
        [{ ...returnRow, state: "sent", signed_pdf_document_id: null }],
        [],
      ]),
      database([]),
    );
    await expect(
      repository.readEsignReturn({
        session,
        opaqueState: "opaque",
        now: new Date("2026-07-31T12:10:00.000Z"),
        requestId: "request-12345678",
      }),
    ).resolves.toMatchObject({ state: "pending", signedDocumentId: null });
  });
});

describe("canonical commercial artifact fallback", () => {
  it("binds partner retrieval to the persisted audience account", async () => {
    const artifactId = "79000000-0000-4000-8000-000000000001";
    const documentId = "7a000000-0000-4000-8000-000000000001";
    const repository = new DatabaseExperienceRepository(
      database([
        [],
        [],
        [],
        [],
        [
          {
            id: artifactId,
            account_id: accountId,
            audience: "partner",
            audience_account_id: accountId,
            subject_type: "quote",
            subject_id: aggregateId,
            document_kind: "partner_resale_quote",
            document_id: documentId,
            immutable_version: "3",
            source_hash: "a".repeat(64),
            content_hash: "b".repeat(64),
            storage_version_id: "immutable-provider-version-3",
            mime_type: "application/pdf",
            byte_length: "2048",
            filename: `partner_resale_quote-${aggregateId}.pdf`,
            retain_until: "2033-07-31T12:00:00.000Z",
            created_at: "2026-07-31T12:00:00.000Z",
            storage_key: `artifacts/${documentId}`,
          },
        ],
      ]),
      database([]),
    );

    await expect(
      repository.findArtifact(
        partnerSession,
        "partner_resale_quote",
        artifactId,
        "partner-artifact-request-12345678",
      ),
    ).resolves.toMatchObject({
      representation: {
        id: artifactId,
        accountId,
        audience: "partner",
        audienceAccountId: accountId,
        documentId,
      },
      storageVersionId: "immutable-provider-version-3",
    });
  });
});

describe("render request state compare-and-swap", () => {
  it("redrives a failed render through an exact version-bound claim", async () => {
    const repository = new DatabaseExperienceRepository(
      database([]),
      database([[], [], [{ row_version: 8 }]]),
    );
    await expect(
      repository.claimRenderRequest(
        failedRenderRequest(),
        "render-redrive-request-12345678",
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects a duplicate worker that loses the render claim CAS", async () => {
    const repository = new DatabaseExperienceRepository(
      database([]),
      database([[], [], []]),
    );
    await expect(
      repository.claimRenderRequest(
        failedRenderRequest(),
        "render-duplicate-request-12345678",
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "RENDER_VERSION_CONFLICT",
    });
  });

  it("rolls back delivery persistence when the terminal state CAS is lost", async () => {
    const request = { ...failedRenderRequest(), status: "pending" as const };
    const repository = new DatabaseExperienceRepository(
      database([]),
      database([
        [],
        [],
        [],
        [{ id: "7c000000-0000-4000-8000-000000000001" }],
        [],
      ]),
    );
    await expect(
      repository.storeArtifact({
        request,
        contentHash: "b".repeat(64),
        byteLength: 2048,
        filename: "direct_quote-fixture.pdf",
        immutableVersion: "1",
        storageKey: "artifacts/direct-quote-fixture.pdf",
        storageVersionId: "provider-version-1",
        requestId: "render-store-race-request-12345678",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "RENDER_VERSION_CONFLICT",
    });
  });
});

/** Collects the literal text of a drizzle `sql` template and its fragments. */
function statementText(query: unknown): string {
  if (!query || typeof query !== "object") return "";
  const chunks = (query as { queryChunks?: readonly unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return "";
  return chunks
    .map((chunk) => {
      if (!chunk || typeof chunk !== "object") return "";
      if ("queryChunks" in chunk) return statementText(chunk);
      const value = (chunk as { value?: unknown }).value;
      return Array.isArray(value) ? value.join("") : "";
    })
    .join("");
}

function capturingDatabase(captured: unknown[]): RuntimeDatabase {
  const transaction = {
    execute: (query: unknown) => {
      captured.push(query);
      return Promise.resolve([]);
    },
  };
  return {
    transaction: async <T>(
      operation: (value: typeof transaction) => Promise<T>,
    ) => operation(transaction),
  } as unknown as RuntimeDatabase;
}

/** The authorized transaction runs role and setting statements first. */
function projectionStatement(captured: readonly unknown[]): string {
  const match = captured
    .map((query) => statementText(query).replace(/\s+/g, " "))
    .find((text) => text.includes("from experience_portal_projections"));
  if (!match) throw new Error("no projection statement was executed");
  return match;
}

function listInput(orderBy?: "updated_desc" | "updated_asc") {
  return {
    session,
    audience: "customer" as const,
    channel: "quotes" as const,
    accountId,
    limit: 25,
    ...(orderBy ? { orderBy } : {}),
    now: new Date("2026-08-01T00:00:00.000Z"),
  };
}

/**
 * Top-N is a server capability, so the ordering and the limit have to reach
 * the statement. The keyset comparison is chosen together with the direction:
 * `<` under an ascending order returns the page *before* the cursor and pages
 * backwards for ever, so the pair is asserted, not just the `order by`.
 *
 * Neither branch wraps the sort columns in an expression -- the read stays on
 * the existing `(source_updated_at, id)` index in both directions.
 */
describe("projection list ordering", () => {
  it("defaults to the descending order every existing caller assumed", async () => {
    const captured: unknown[] = [];
    const repository = new DatabaseExperienceRepository(
      capturingDatabase(captured),
      database([]),
    );

    await repository.listProjections(listInput());

    const text = projectionStatement(captured);
    expect(text).toContain("order by source_updated_at desc, id desc");
    expect(text).toContain("(source_updated_at, id) < (");
  });

  it("asks the database for the ascending page, with the matching comparison", async () => {
    const captured: unknown[] = [];
    const repository = new DatabaseExperienceRepository(
      capturingDatabase(captured),
      database([]),
    );

    await repository.listProjections(listInput("updated_asc"));

    const text = projectionStatement(captured);
    expect(text).toContain("order by source_updated_at asc, id asc");
    expect(text).toContain("(source_updated_at, id) > (");
    expect(text).not.toContain("(source_updated_at, id) < (");
  });

  it("keeps the sort on the indexed columns rather than an expression", async () => {
    const captured: unknown[] = [];
    const repository = new DatabaseExperienceRepository(
      capturingDatabase(captured),
      database([]),
    );

    await repository.listProjections(listInput("updated_asc"));

    expect(projectionStatement(captured)).not.toContain("case when");
  });
});

/**
 * The account predicate decides whether the read uses
 * `experience_projection_page_idx` at all. Measured on Postgres 17 with 50,000
 * rows on that index: `is not distinct from $1` plans a `Seq Scan` plus a full
 * `Sort` for every page, `= $1` plans an `Index Only Scan`, and the ascending
 * order plans an `Index Only Scan Backward` on the same index.
 *
 * The two branches select exactly the rows the single predicate selected, so
 * nothing here is a scope change -- `assertions` in `authorization.test.ts` and
 * the `experience_projection_read` policy still hold the tenant boundary. What
 * is asserted is only that the indexable form is the one emitted.
 */
describe("projection account scope", () => {
  it("uses an indexable equality for a tenant read", async () => {
    const captured: unknown[] = [];
    const repository = new DatabaseExperienceRepository(
      capturingDatabase(captured),
      database([]),
    );

    await repository.listProjections(listInput());

    const text = projectionStatement(captured);
    expect(text).toContain("audience_account_id = ");
    expect(text).not.toContain("is not distinct from");
  });

  it("uses a null test for the unscoped internal read", async () => {
    const captured: unknown[] = [];
    const repository = new DatabaseExperienceRepository(
      capturingDatabase(captured),
      database([]),
    );

    await repository.listProjections({
      ...listInput(),
      audience: "internal",
      accountId: null,
    });

    const text = projectionStatement(captured);
    expect(text).toContain("audience_account_id is null");
    expect(text).not.toContain("is not distinct from");
  });

  it("applies the same form to the record detail read", async () => {
    const captured: unknown[] = [];
    const repository = new DatabaseExperienceRepository(
      capturingDatabase(captured),
      database([]),
    );

    await expect(
      repository.findProjection({
        session,
        audience: "customer",
        channel: "quotes",
        accountId,
        recordKey: "Q-2026-0001",
        now: new Date("2026-08-01T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "PROJECTION_NOT_FOUND" });

    const text = projectionStatement(captured);
    expect(text).toContain("audience_account_id = ");
    expect(text).not.toContain("is not distinct from");
  });
});
