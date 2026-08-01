import type { SessionClaims } from "@clockwork/api";
import type { RuntimeDatabase } from "@clockwork/db";
import { beforeEach, describe, expect, it } from "vitest";

import { DatabaseExperienceRepository } from "./repository";

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
      createdAt: "2026-07-31T12:00:00.000Z",
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
          command_resource: "quote.accept",
          subject_account_id: accountId,
          row_version: 4,
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
