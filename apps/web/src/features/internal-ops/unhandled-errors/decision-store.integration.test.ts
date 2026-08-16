import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  appendAuditAndOutbox,
  createRuntimeDatabase,
  withInternalTransaction,
} from "@clockwork/db";

import { recordUnhandledErrorDecision } from "./decision-store";
import { readRuntimeFailureIncidents } from "./incident-repository";
import { decisionReasonLimits, providerMessageProvenance } from "./model";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 1,
  role: "clockwork_service",
  ssl: false,
});

/**
 * `audit_events` is append-only and the delete is refused by a trigger, so every
 * fixture takes a fresh aggregate id and the rows stay behind for good.
 *
 * That has a consequence worth stating plainly rather than burying: running
 * `pnpm test:integration` permanently adds these fake runtime failures to
 * whatever database it points at, and they then render on
 * `/internal/unhandled-errors` as real incidents, indistinguishable from real
 * ones. `pnpm db:reset` is the only way to remove them. This is recorded under
 * "Known limits" in docs/operations/unhandled-errors.md so an operator reading
 * a developer database is not misled by rows this file wrote. The alternative
 * -- teaching the surface to hide rows written by a fixture actor -- would be a
 * filter that could also hide real failures, which is worse.
 */
const failureAggregateId = crypto.randomUUID();
const controlAggregateId = crypto.randomUUID();
const provisioningAggregateId = crypto.randomUUID();
const operatorId = "20000000-0000-4000-8000-000000000001";

/** The provisioning-provider failure path: attempt, provider operation, event. */
const providerAttemptId = crypto.randomUUID();
const providerOperationId = crypto.randomUUID();
const providerIdempotencyKey = `unhandled-errors-op-${crypto.randomUUID()}`;
const providerCommandId = `unhandled-errors-op-${crypto.randomUUID()}`;
const providerEffectMessage =
  "Provider rejected the entitlement quantity for region eu-west-1";

/** The seeded order the provisioning attempt has to hang off; it has FKs. */
const seededOrderId = "80000000-0000-4000-8000-000000000001";
const seededAccountId = "10000000-0000-4000-8000-000000000001";
const seededOrganizationId = "30000000-0000-4000-8000-000000000001";
const provisioningCommandId = `unhandled-errors-${crypto.randomUUID()}`;
const providerMessage = "Region eu-west-1 rejected the tenant identifier";

let failureEventId = "";
let controlEventId = "";
let provisioningEventId = "";
let providerEffectEventId = "";

async function seed(input: {
  aggregateType: "workflow_run" | "order" | "provider_operation";
  aggregateId: string;
  eventType: string;
  after: Record<string, unknown>;
}): Promise<string> {
  return withInternalTransaction(
    db,
    `unhandled-errors-fixture:${input.aggregateId}`,
    async (transaction) => {
      await appendAuditAndOutbox(transaction, {
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        aggregateVersion: 1,
        eventType: input.eventType,
        actor: { kind: "system", id: "unhandled-errors-fixture" },
        requestId: `unhandled-errors-fixture:${input.aggregateId}`,
        occurredAt: new Date(),
        after: input.after,
      });
      const rows = await transaction.execute(sql`
        select id::text as id
        from public.audit_events
        where aggregate_type = ${input.aggregateType}
          and aggregate_id = ${input.aggregateId}::uuid
      `);
      return String((rows[0] as { id: string }).id);
    },
  );
}

beforeAll(async () => {
  failureEventId = await seed({
    aggregateType: "workflow_run",
    aggregateId: failureAggregateId,
    eventType: "workflow.task.dead_lettered",
    after: {
      code: "PROVIDER_TIMEOUT",
      status: "failed",
      taskId: "unhandled-errors-integration",
      attempt: 3,
    },
  });
  controlEventId = await seed({
    aggregateType: "order",
    aggregateId: controlAggregateId,
    eventType: "core.orders.create",
    after: { status: "draft" },
  });

  // The one failure shape whose cause survives the write. The attempt document
  // is the shape `ProvisioningAttemptSchema` parses, and `commandId` on the
  // audit row is the only key that joins the two.
  await withInternalTransaction(
    db,
    `unhandled-errors-provisioning:${provisioningCommandId}`,
    (transaction) =>
      transaction.execute(sql`
        insert into public.lifecycle_provisioning_attempts (
          command_id, account_id, order_id, organization_id, operation,
          state, attempt
        ) values (
          ${provisioningCommandId}, ${seededAccountId}::uuid,
          ${seededOrderId}::uuid, ${seededOrganizationId}::uuid, 'provision',
          'dead_letter',
          ${JSON.stringify({
            lastError: {
              code: "PROVISIONING_REGION_REJECTED",
              message: providerMessage,
              kind: "permanent",
            },
          })}::jsonb
        )
      `),
  );
  provisioningEventId = await seed({
    aggregateType: "order",
    aggregateId: provisioningAggregateId,
    eventType: "order.provisioning_dead_lettered",
    after: { state: "dead_letter", commandId: provisioningCommandId },
  });

  // The path that got the first version of this surface refuted. On a permanent
  // provisioning-provider failure, checkpointProviderEffect appends
  // `lifecycle.provider_effect.dead_lettered` against the provider operation
  // and the paired store.record() call appends no audit event at all, so this
  // row is the only durable record of the failure. It carries a coerced code and
  // no commandId; the provider's own words survive on the attempt document,
  // which provider_operations.aggregate_id points at.
  await withInternalTransaction(
    db,
    `unhandled-errors-provider-effect:${providerIdempotencyKey}`,
    async (transaction) => {
      await transaction.execute(sql`
        insert into public.lifecycle_provisioning_attempts (
          id, command_id, account_id, order_id, organization_id, operation,
          state, attempt
        ) values (
          ${providerAttemptId}::uuid, ${providerCommandId},
          ${seededAccountId}::uuid, ${seededOrderId}::uuid,
          ${seededOrganizationId}::uuid, 'provision', 'dead_letter',
          ${JSON.stringify({
            lastError: {
              ok: false,
              kind: "permanent",
              code: "PROVISIONING_ENTITLEMENT_REJECTED",
              message: providerEffectMessage,
            },
          })}::jsonb
        )
      `);
      await transaction.execute(sql`
        insert into public.provider_operations (
          id, provider, operation, idempotency_key, aggregate_type,
          aggregate_id, status, attempt_count, last_error
        ) values (
          ${providerOperationId}::uuid, 'lifecycle-provisioning', 'provision',
          ${providerIdempotencyKey}, 'provider_operation',
          ${providerAttemptId}::uuid, 'failed', 1,
          'PROVISIONING_PROVIDER_FAILURE'
        )
      `);
    },
  );
  providerEffectEventId = await seed({
    aggregateType: "provider_operation",
    aggregateId: providerOperationId,
    eventType: "lifecycle.provider_effect.dead_lettered",
    after: {
      provider: "lifecycle-provisioning",
      operation: "provision",
      status: "failed",
      attempt: 1,
      code: "PROVISIONING_PROVIDER_FAILURE",
    },
  });
});

afterAll(async () => {
  await withInternalTransaction(
    db,
    `unhandled-errors-cleanup:${provisioningCommandId}`,
    (transaction) =>
      transaction.execute(sql`
        delete from public.lifecycle_provisioning_attempts
        where command_id in (${provisioningCommandId}, ${providerCommandId})
      `),
  );
  await withInternalTransaction(
    db,
    `unhandled-errors-cleanup-operation:${providerIdempotencyKey}`,
    (transaction) =>
      transaction.execute(sql`
        delete from public.provider_operations
        where idempotency_key = ${providerIdempotencyKey}
      `),
  );
  await client.end();
});

describe("recording an operator decision about an unhandled failure", () => {
  it("refuses an anchor that is not a runtime failure", async () => {
    // Without the catalogue predicate in the store's select, this call
    // succeeds and attaches a containment record to an order creation.
    await expect(
      recordUnhandledErrorDecision(db, {
        auditEventId: controlEventId,
        decision: "contain",
        reason: "attaching to the wrong anchor",
        actor: { kind: "user", id: operatorId },
        requestId: `unhandled-errors-control:${crypto.randomUUID()}`,
      }),
    ).rejects.toThrow("UNHANDLED_ERROR_NOT_FOUND");
  });

  it("refuses an anchor that does not exist", async () => {
    await expect(
      recordUnhandledErrorDecision(db, {
        auditEventId: crypto.randomUUID(),
        decision: "contain",
        reason: "no such failure",
        actor: { kind: "user", id: operatorId },
        requestId: `unhandled-errors-missing:${crypto.randomUUID()}`,
      }),
    ).rejects.toThrow("UNHANDLED_ERROR_NOT_FOUND");
  });

  it("refuses a reason too short to be evidence", async () => {
    await expect(
      recordUnhandledErrorDecision(db, {
        auditEventId: failureEventId,
        decision: "contain",
        reason: "short",
        actor: { kind: "user", id: operatorId },
        requestId: `unhandled-errors-reason:${crypto.randomUUID()}`,
      }),
    ).rejects.toThrow("UNHANDLED_ERROR_REASON_REQUIRED");
  });

  it("writes the record and its outbox row atomically", async () => {
    const first = await recordUnhandledErrorDecision(db, {
      auditEventId: failureEventId,
      decision: "contain",
      reason: "gate EXT-PROVIDER-01 disabled while the provider is timing out",
      containmentReference: "EXT-PROVIDER-01",
      actor: { kind: "user", id: operatorId },
      requestId: `unhandled-errors-contain:${crypto.randomUUID()}`,
    });
    expect(first.recordVersion).toBe(1);

    const rows = await withInternalTransaction(
      db,
      `unhandled-errors-assert:${crypto.randomUUID()}`,
      (transaction) =>
        transaction.execute(sql`
          select record.event_type,
                 record.aggregate_version,
                 record.after->>'reason' as reason,
                 record.after->>'containmentReference' as containment_reference,
                 record.after->>'safeCode' as safe_code,
                 record.actor->>'id' as actor_id,
                 message.id::text as outbox_id,
                 message.topic
          from public.audit_events record
          left join public.outbox_messages message
            on message.event_id = record.id
          where record.aggregate_type = 'audit_event'
            and record.aggregate_id = ${failureEventId}::uuid
          order by record.aggregate_version
        `),
    );
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row.event_type).toBe("system.unhandled_error.contained");
    expect(row.aggregate_version).toBe(1);
    expect(row.actor_id).toBe(operatorId);
    expect(row.containment_reference).toBe("EXT-PROVIDER-01");
    // The failure's own code travels onto the record, so the evidence stands
    // alone without re-reading the anchor.
    expect(row.safe_code).toBe("PROVIDER_TIMEOUT");
    expect(row.outbox_id).not.toBeNull();
    expect(row.topic).toBe("system.unhandled_error.contained");
  });

  /**
   * The sequence is the property that keeps this off the runtime's numbering.
   * A store that reused a fixed version, or that numbered from a source row's
   * `row_version`, fails here on `audit_aggregate_version_unique`.
   */
  it("numbers a second record above the first", async () => {
    const second = await recordUnhandledErrorDecision(db, {
      auditEventId: failureEventId,
      decision: "release",
      reason: "provider recovered and the gate is active again",
      actor: { kind: "user", id: operatorId },
      requestId: `unhandled-errors-release:${crypto.randomUUID()}`,
    });
    expect(second.recordVersion).toBe(2);
  });

  it("leaves the anchor event untouched", async () => {
    const rows = await withInternalTransaction(
      db,
      `unhandled-errors-anchor:${crypto.randomUUID()}`,
      (transaction) =>
        transaction.execute(sql`
          select event_type, aggregate_version, after->>'code' as code
          from public.audit_events
          where id = ${failureEventId}::uuid
        `),
    );
    const row = rows[0] as Record<string, unknown>;
    expect(row.event_type).toBe("workflow.task.dead_lettered");
    expect(row.aggregate_version).toBe(1);
    expect(row.code).toBe("PROVIDER_TIMEOUT");
  });
});

describe("reading the failures back", () => {
  it("lists the failure with its decisions and excludes the control event", async () => {
    const queue = await readRuntimeFailureIncidents(db, {
      requestId: `unhandled-errors-read:${crypto.randomUUID()}`,
      limit: 200,
    });
    expect(queue.readable).toBe(true);

    const incident = queue.incidents.find(
      (candidate) => candidate.auditEventId === failureEventId,
    );
    expect(incident).toBeDefined();
    expect(incident?.safeCode).toBe("PROVIDER_TIMEOUT");
    expect(incident?.aggregateType).toBe("workflow_run");
    expect(incident?.decisionCount).toBe(2);
    expect(incident?.latestDecision).toBe("release");
    expect(incident?.outboxMessageId).not.toBeNull();

    // The whole point of the disclosure on the page: this failure has no cause
    // stored anywhere, and the loader says so rather than leaving the column
    // blank.
    expect(incident?.diagnosis.kind).toBe("code_only");
    if (incident?.diagnosis.kind === "code_only")
      expect(incident.diagnosis.discardedAt).toContain(
        "workflow_runs.last_error",
      );

    expect(
      queue.incidents.some(
        (candidate) => candidate.auditEventId === controlEventId,
      ),
    ).toBe(false);
  });

  /**
   * The claim the page makes about itself, proved against a real row: the one
   * writer that keeps a provider message is joined and shown. Without the join
   * on `attempt.command_id = failure.after->>'commandId'` this row reads
   * `code_only` like every other, and the surface's "With a cause" count is
   * permanently zero -- a disclosure that would be true by accident.
   */
  it("shows the provider message the provisioning attempt kept", async () => {
    const queue = await readRuntimeFailureIncidents(db, {
      requestId: `unhandled-errors-cause:${crypto.randomUUID()}`,
      limit: 200,
    });
    const incident = queue.incidents.find(
      (candidate) => candidate.auditEventId === provisioningEventId,
    );
    expect(incident).toBeDefined();
    // This writer records no code at all, which is itself worth seeing.
    expect(incident?.safeCode).toBeNull();
    expect(incident?.diagnosis).toEqual({
      kind: "provider_message",
      message: providerMessage,
      provenance: providerMessageProvenance.commandAttempt,
    });
  });

  /**
   * The refutation's finding, closed against a real row chain.
   *
   * `lifecycle.provider_effect.dead_lettered` is the only durable audit event
   * on the permanent provisioning-provider failure path. While it was absent
   * from the catalogue the page showed nothing during exactly the outage this
   * runbook exists for. It is on the list now, and its cause -- which lives on
   * the attempt document, two joins from the audit row -- is shown rather than
   * reported as discarded.
   */
  it("lists a provisioning-provider failure and reaches its cause", async () => {
    const queue = await readRuntimeFailureIncidents(db, {
      requestId: `unhandled-errors-provider-effect:${crypto.randomUUID()}`,
      limit: 200,
    });
    const incident = queue.incidents.find(
      (candidate) => candidate.auditEventId === providerEffectEventId,
    );
    expect(incident).toBeDefined();
    expect(incident?.eventType).toBe("lifecycle.provider_effect.dead_lettered");
    expect(incident?.aggregateType).toBe("provider_operation");
    // The audit row itself carries the coerced code and nothing else: no
    // boundary, no task identifier. Each of those absences is rendered as an
    // absence rather than filled from another column.
    expect(incident?.safeCode).toBe("PROVISIONING_PROVIDER_FAILURE");
    expect(incident?.boundary).toBeNull();
    expect(incident?.taskIdentifier).toBeNull();
    // Without the provider_operations -> attempt join this reads "Code only".
    expect(incident?.diagnosis).toEqual({
      kind: "provider_message",
      message: providerEffectMessage,
      provenance: providerMessageProvenance.operationAttempt,
    });
  });

  /**
   * Every identifier the runbook's step 1 asks this surface for is on the
   * incident, because the runbook says it is. The outbox message id was being
   * selected and then dropped before render while the doc claimed the surface
   * carried it.
   */
  it("carries every identifier the runbook asks the operator to record", () => {
    return readRuntimeFailureIncidents(db, {
      requestId: `unhandled-errors-identifiers:${crypto.randomUUID()}`,
      limit: 200,
    }).then((queue) => {
      const incident = queue.incidents.find(
        (candidate) => candidate.auditEventId === failureEventId,
      );
      expect(incident?.auditEventId).toBe(failureEventId);
      expect(incident?.requestId).toContain("unhandled-errors-fixture");
      expect(incident?.aggregateId).toBe(failureAggregateId);
      expect(incident?.taskIdentifier).toBe("unhandled-errors-integration");
      expect(incident?.outboxMessageId).toEqual(expect.any(String));
    });
  });
});

describe("what the decision count counts", () => {
  /**
   * The count is over the two decision event types, not over every row on the
   * `audit_event` aggregate. Only this store writes there today, so the wider
   * count was right by accident; this test is what makes it stay right.
   */
  it("ignores a non-decision audit row appended against the same anchor", async () => {
    const before = await readRuntimeFailureIncidents(db, {
      requestId: `unhandled-errors-count-before:${crypto.randomUUID()}`,
      limit: 200,
    });
    const start = before.incidents.find(
      (candidate) => candidate.auditEventId === failureEventId,
    )?.decisionCount;
    expect(start).toBe(2);

    await withInternalTransaction(
      db,
      `unhandled-errors-foreign:${crypto.randomUUID()}`,
      (transaction) =>
        appendAuditAndOutbox(transaction, {
          aggregateType: "audit_event",
          aggregateId: failureEventId,
          aggregateVersion: 3,
          eventType: "system.unhandled_error.annotated",
          actor: { kind: "system", id: "unhandled-errors-fixture" },
          requestId: `unhandled-errors-foreign:${failureEventId}`,
          occurredAt: new Date(),
          after: { note: "a writer this surface does not own" },
        }),
    );

    const after = await readRuntimeFailureIncidents(db, {
      requestId: `unhandled-errors-count-after:${crypto.randomUUID()}`,
      limit: 200,
    });
    const incident = after.incidents.find(
      (candidate) => candidate.auditEventId === failureEventId,
    );
    expect(incident?.decisionCount).toBe(2);
    // The latest decision is still the release, not the foreign row.
    expect(incident?.latestDecision).toBe("release");
  });
});

describe("anchoring a decision on a provisioning-provider failure", () => {
  it("accepts the event type the catalogue was missing", async () => {
    const recorded = await recordUnhandledErrorDecision(db, {
      auditEventId: providerEffectEventId,
      decision: "contain",
      reason: "provider capability disabled on the gate register",
      containmentReference: "https://tickets.test/browse?id=4421",
      actor: { kind: "user", id: operatorId },
      requestId: `unhandled-errors-provider-contain:${crypto.randomUUID()}`,
    });
    expect(recorded.recordVersion).toBe(1);
  });

  it("refuses a reason longer than the surface says it accepts", async () => {
    await expect(
      recordUnhandledErrorDecision(db, {
        auditEventId: providerEffectEventId,
        decision: "release",
        reason: "x".repeat(decisionReasonLimits.max + 1),
        actor: { kind: "user", id: operatorId },
        requestId: `unhandled-errors-long-reason:${crypto.randomUUID()}`,
      }),
    ).rejects.toThrow("UNHANDLED_ERROR_REASON_TOO_LONG");
  });
});
