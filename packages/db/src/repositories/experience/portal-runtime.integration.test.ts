import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { ids } from "@clockwork/contracts";

import { createRuntimeDatabase } from "../../client";
import {
  withAuthorizedTransaction,
  withInternalTransaction,
} from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";
import {
  DatabasePortalActionPersistence,
  DatabasePortalProjectionMaterializer,
} from "./portal-runtime";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";
const accountId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000002";
const projectionId = randomUUID();
const aggregateId = randomUUID();
const actionId = randomUUID();
const now = new Date();

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 2,
  role: "clockwork_service",
  ssl: false,
});
const actions = new DatabasePortalActionPersistence(db, 30_000);
const projections = new DatabasePortalProjectionMaterializer(db);

async function seedAction(
  input: {
    actionId?: string;
    projectionId?: string;
    aggregateId?: string;
  } = {},
) {
  const seededActionId = input.actionId ?? actionId;
  const seededProjectionId = input.projectionId ?? projectionId;
  const seededAggregateId = input.aggregateId ?? aggregateId;
  await withInternalTransaction(
    db,
    `portal-action:${seededActionId}:projection`,
    (tx) =>
      tx.execute(sql`
      insert into public.experience_portal_projections (
        id, audience, audience_account_id, subject_account_id, channel,
        record_key, aggregate_type, aggregate_id, command_resource, payload,
        source_hash, source_aggregate_version, source_updated_at, projected_at
      ) values (
        ${seededProjectionId}::uuid, 'customer', ${accountId}::uuid,
        ${accountId}::uuid, 'quotes', ${`integration-${seededActionId}`},
        'quote', ${seededAggregateId}::uuid, 'experience:quotes',
        '{"allowedActions":["accept"]}'::jsonb, ${"a".repeat(64)}, 1,
        ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz
      )
    `),
  );
  return withAuthorizedTransaction(
    db,
    {
      userId: ids.user.parse(userId),
      accountIds: [ids.account.parse(accountId)],
      roles: ["owner"],
      isInternalStaff: false,
      requestId: `portal-action:${seededActionId}:queue`,
    },
    { secret: authorizationSecret },
    async (tx) => {
      const rows = await tx.execute(sql`
        insert into public.experience_projection_action_requests (
          id, projection_id, audience_account_id, subject_account_id,
          aggregate_type, aggregate_id, command_resource, action,
          expected_version, actor_user_id, effective_account_id,
          idempotency_key, request_payload
        ) values (
          ${seededActionId}::uuid, ${seededProjectionId}::uuid, ${accountId}::uuid,
          ${accountId}::uuid, 'quote', ${seededAggregateId}::uuid,
          'experience:quotes', 'accept', 1, ${userId}::uuid,
          ${accountId}::uuid, ${`portal-action-${seededActionId}`}, '{}'::jsonb
        ) returning audit_event_id, outbox_message_id
      `);
      return {
        ...(rows[0] as {
          audit_event_id: string;
          outbox_message_id: string;
        }),
        actionId: seededActionId,
        projectionId: seededProjectionId,
        aggregateId: seededAggregateId,
      };
    },
  );
}

afterAll(async () => {
  await client.end();
});

describe.sequential("portal runtime persistence", () => {
  it("leases an action, commits one terminal result, and replays it", async () => {
    const seeded = await seedAction();
    const claim = await actions.claim({
      actionRequestId: actionId,
      eventId: seeded.audit_event_id,
      messageId: seeded.outbox_message_id,
      idempotencyKey: `outbox:${seeded.outbox_message_id}`,
      now,
    });
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") throw new Error("claim was not acquired");
    await expect(
      actions.claim({
        actionRequestId: actionId,
        eventId: seeded.audit_event_id,
        messageId: seeded.outbox_message_id,
        idempotencyKey: `outbox:${seeded.outbox_message_id}`,
        now: new Date(now.getTime() + 1),
      }),
    ).resolves.toMatchObject({ status: "busy" });
    const outcome = {
      status: "applied" as const,
      code: "PORTAL_ACTION_APPLIED",
      resultReference: `quote:${aggregateId}:version:2`,
      authoritativeVersion: 2,
      commandReplayed: false,
    };
    await expect(
      actions.finish({
        actionRequestId: actionId,
        claimToken: claim.claimToken,
        eventId: seeded.audit_event_id,
        requestId: `portal-action:${actionId}:finish`,
        completedAt: new Date(now.getTime() + 2),
        outcome,
      }),
    ).resolves.toEqual(outcome);
    await expect(
      actions.claim({
        actionRequestId: actionId,
        eventId: seeded.audit_event_id,
        messageId: seeded.outbox_message_id,
        idempotencyKey: `outbox:${seeded.outbox_message_id}`,
        now: new Date(now.getTime() + 3),
      }),
    ).resolves.toMatchObject({ status: "terminal", outcome });
  });

  it("replays migrated terminal truth without coercing unknown command replay", async () => {
    const seeded = await seedAction({
      actionId: randomUUID(),
      projectionId: randomUUID(),
      aggregateId: randomUUID(),
    });
    await withInternalTransaction(
      db,
      `portal-action:${seeded.actionId}:legacy-terminal`,
      (tx) =>
        tx.execute(sql`
          update public.experience_projection_action_requests
          set status = 'applied',
              result_reference = ${`legacy-action:${seeded.actionId}:applied`},
              result_code = 'LEGACY_PORTAL_ACTION_APPLIED',
              authoritative_version = null,
              command_replayed = null,
              completed_at = ${now.toISOString()}::timestamptz
          where id = ${seeded.actionId}::uuid
        `),
    );

    await expect(
      actions.claim({
        actionRequestId: seeded.actionId,
        eventId: seeded.audit_event_id,
        messageId: seeded.outbox_message_id,
        idempotencyKey: `outbox:${seeded.outbox_message_id}`,
        now,
      }),
    ).resolves.toMatchObject({
      status: "terminal",
      outcome: {
        status: "applied",
        code: "LEGACY_PORTAL_ACTION_APPLIED",
        commandReplayed: null,
      },
    });
  });

  it("materializes and deduplicates an authoritative projection set", async () => {
    const sourceAggregateId = randomUUID();
    const source = await withInternalTransaction(
      db,
      `projection-source:${sourceAggregateId}`,
      (tx) =>
        appendAuditAndOutbox(tx, {
          accountId,
          aggregateType: "account",
          aggregateId: sourceAggregateId,
          aggregateVersion: 1,
          eventType: "account.portal_projection_requested",
          actor: { kind: "system", id: "portal-runtime-integration" },
          requestId: `projection-source:${sourceAggregateId}`,
          occurredAt: now,
          after: { accountId },
        }),
    );
    const input = {
      eventId: source.event.id,
      eventType: "account.portal_projection_requested",
      aggregateType: "account",
      aggregateId: sourceAggregateId,
      aggregateVersion: 1,
      sourceVersion: 1,
      sourceHash: "b".repeat(64),
      sourceUpdatedAt: now.toISOString(),
      actor: { kind: "system" as const, id: "portal-runtime-integration" },
      requestId: `projection-materialize:${sourceAggregateId}`,
      projectedAt: now,
      projections: [
        {
          audience: "customer" as const,
          audienceAccountId: accountId,
          subjectAccountId: accountId,
          channel: "dashboard",
          recordKey: `integration-${sourceAggregateId}`,
          commandResource: null,
          payload: { title: "Authoritative account state", allowedActions: [] },
          aggregateType: "account",
          aggregateId: sourceAggregateId,
          sourceVersion: 1,
          sourceHash: "b".repeat(64),
          sourceUpdatedAt: now.toISOString(),
        },
      ],
    };
    await expect(projections.materialize(input)).resolves.toEqual({
      status: "applied",
      projectionCount: 1,
    });
    await expect(projections.materialize(input)).resolves.toEqual({
      status: "duplicate",
      projectionCount: 1,
    });
  });
});
