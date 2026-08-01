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
