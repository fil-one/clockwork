import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import { withInternalTransaction } from "../../transaction";
import { DatabaseSystemRecoveryCommandExecutor } from "./authoritative-command";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 4,
  role: "clockwork_service",
  ssl: false,
});

const now = new Date("2026-08-02T12:00:00.000Z");
const executor = new DatabaseSystemRecoveryCommandExecutor({
  database: db,
  now: () => now,
});

/** Seeded internal operator, and a customer user with no system permission. */
const internalUserId = "20000000-0000-4000-8000-000000000001";
const tenantUserId = "20000000-0000-4000-8000-000000000004";
const orderId = "80000000-0000-4000-8000-000000000007";
const staffOrganizationId = "30000000-0000-4000-8000-000000000008";
const suffix = crypto.randomUUID().slice(0, 8);

const fixture: Readonly<{
  runId: string;
  secondRunId: string;
  thirdRunId: string;
  /** Internal staff whose roles carry no `system:operate`. */
  reviewerId: string;
  reviewerMembershipId: string;
}> = {
  runId: crypto.randomUUID(),
  secondRunId: crypto.randomUUID(),
  thirdRunId: crypto.randomUUID(),
  reviewerId: crypto.randomUUID(),
  reviewerMembershipId: crypto.randomUUID(),
};

function request(overrides: Partial<Parameters<typeof executor.execute>[0]>) {
  return {
    action: "abandon" as const,
    source: "workflow_run" as const,
    id: fixture.runId,
    reason: "Superseded by a replacement order",
    actor: { kind: "user" as const, id: internalUserId },
    mfaVerified: true,
    recentAuthenticationVerified: true,
    authorizationCreatedAt: now.toISOString(),
    idempotencyKey: `system-recovery-${suffix}-${crypto.randomUUID()}`,
    requestId: `system-recovery-${suffix}`,
    ...overrides,
  };
}

async function seedRun(id: string, key: string) {
  await withInternalTransaction(db, `recovery-seed-${suffix}`, (tx) =>
    tx.execute(sql`
      insert into public.workflow_runs (
        id, task_identifier, idempotency_key, aggregate_type, aggregate_id,
        status, attempt_count, input, last_error, updated_at
      ) values (
        ${id}::uuid, 'lifecycle-provisioning-command-dispatch-v1', ${key},
        'order', ${orderId}::uuid, 'failed', 4, '{}'::jsonb,
        'WORKFLOW_TASK_DEAD_LETTERED', '2026-08-01T02:00:00.000Z'::timestamptz
      )
    `),
  );
}

/**
 * Internal staff carrying a role without `system:operate`. A tenant actor is
 * refused earlier, at `is_internal_staff`, so it never reaches the permission
 * check this user exists to exercise.
 */
async function seedReviewer() {
  await withInternalTransaction(
    db,
    `recovery-reviewer-${suffix}`,
    async (tx) => {
      await tx.execute(sql`
      insert into public.commerce_users (
        id, workos_user_id, email, name, is_internal_staff, mfa_enrolled
      ) values (
        ${fixture.reviewerId}::uuid, ${`recovery_reviewer_${suffix}`},
        ${`recovery-reviewer-${suffix}@filone.test`}, 'Recovery Reviewer',
        true, true
      )
    `);
      await tx.execute(sql`
      insert into public.memberships (id, organization_id, user_id, role) values (
        ${fixture.reviewerMembershipId}::uuid, ${staffOrganizationId}::uuid,
        ${fixture.reviewerId}::uuid, 'legal_approver'
      )
    `);
    },
  );
}

beforeAll(async () => {
  await seedRun(fixture.runId, `recovery-run-${suffix}`);
  await seedRun(fixture.secondRunId, `recovery-run-second-${suffix}`);
  await seedRun(fixture.thirdRunId, `recovery-run-third-${suffix}`);
  await seedReviewer();
});

afterAll(async () => {
  await withInternalTransaction(db, `recovery-clean-${suffix}`, async (tx) => {
    await tx.execute(sql`
      delete from public.workflow_runs
      where id in (
        ${fixture.runId}::uuid, ${fixture.secondRunId}::uuid,
        ${fixture.thirdRunId}::uuid
      )
    `);
    await tx.execute(sql`
      delete from public.lifecycle_idempotency_records
      where owner_user_id in (
        ${internalUserId}::uuid, ${fixture.reviewerId}::uuid
      )
        and scope = 'system:recovery'
        and key like ${`system-recovery-${suffix}%`}
    `);
    await tx.execute(
      sql`delete from public.memberships where id = ${fixture.reviewerMembershipId}::uuid`,
    );
    await tx.execute(
      sql`delete from public.commerce_users where id = ${fixture.reviewerId}::uuid`,
    );
  });
  await client.end();
});

describe("system recovery command authorization", () => {
  it("refuses a tenant actor who holds no system permission", async () => {
    const result = await executor.execute(
      request({ actor: { kind: "user", id: tenantUserId } }),
    );
    expect(result).toMatchObject({
      ok: false,
      code: "SYSTEM_RECOVERY_AUTHORIZATION_REVOKED",
    });
  });

  it("refuses an actor whose authentication is not recent", async () => {
    const result = await executor.execute(
      request({ recentAuthenticationVerified: false }),
    );
    expect(result).toMatchObject({
      ok: false,
      code: "SYSTEM_RECOVERY_AUTHORIZATION_REVOKED",
    });
  });

  it("refuses authorization older than the freshness window", async () => {
    const result = await executor.execute(
      request({
        authorizationCreatedAt: new Date(
          now.getTime() - 10 * 60_000,
        ).toISOString(),
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      code: "SYSTEM_RECOVERY_AUTHORIZATION_EXPIRED",
    });
  });

  it("refuses a reason too short to be evidence", async () => {
    const result = await executor.execute(request({ reason: "no" }));
    expect(result).toMatchObject({
      ok: false,
      code: "SYSTEM_RECOVERY_INVALID",
    });
  });

  it("applies an authorized abandonment and records the audit evidence", async () => {
    const result = await executor.execute(request({}));
    expect(result.ok).toBe(true);
    const rows = await withInternalTransaction(
      db,
      `recovery-assert-${suffix}`,
      (tx) =>
        tx.execute(sql`
          select run.status, decision.event_type,
                 decision.after->>'reason' as reason,
                 decision.actor->>'id' as actor_id
          from public.workflow_runs run
          join public.audit_events decision
            on decision.aggregate_type = 'workflow_run'
           and decision.aggregate_id = run.id
          where run.id = ${fixture.runId}::uuid
        `),
    );
    expect(rows).toEqual([
      {
        status: "cancelled",
        event_type: "system.dead_letter.abandoned",
        reason: "Superseded by a replacement order",
        actor_id: internalUserId,
      },
    ]);
  });

  it("refuses internal staff whose roles do not carry system:operate", async () => {
    const result = await executor.execute(
      request({
        id: fixture.thirdRunId,
        actor: { kind: "user", id: fixture.reviewerId },
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      code: "SYSTEM_RECOVERY_PERMISSION_REVOKED",
    });
  });

  it("refuses a privileged role without verified MFA", async () => {
    const result = await executor.execute(
      request({ id: fixture.thirdRunId, mfaVerified: false }),
    );
    expect(result).toMatchObject({
      ok: false,
      code: "SYSTEM_RECOVERY_AUTHORIZATION_REVOKED",
    });
  });

  it("does not apply the same decision twice", async () => {
    const idempotencyKey = `system-recovery-${suffix}-repeat`;
    const decision = request({ id: fixture.thirdRunId, idempotencyKey });
    expect((await executor.execute(decision)).ok).toBe(true);
    expect(await executor.execute(decision)).toMatchObject({
      ok: false,
      code: "DEAD_LETTER_OPERATION_ALREADY_DECIDED",
    });
    const rows = await withInternalTransaction(
      db,
      `recovery-repeat-${suffix}`,
      (tx) =>
        tx.execute(sql`
          select run.status,
                 (
                   select count(*)::int
                   from public.audit_events decision
                   where decision.aggregate_type = 'workflow_run'
                     and decision.aggregate_id = run.id
                 ) as decisions
          from public.workflow_runs run
          where run.id = ${fixture.thirdRunId}::uuid
        `),
    );
    expect(rows).toEqual([{ status: "cancelled", decisions: 1 }]);
  });

  it("refuses a different decision replayed under one idempotency key", async () => {
    const idempotencyKey = `system-recovery-shared-${suffix}`;
    const first = await executor.execute(
      request({ id: fixture.secondRunId, idempotencyKey }),
    );
    expect(first.ok).toBe(true);
    const second = await executor.execute(
      request({
        id: fixture.secondRunId,
        idempotencyKey,
        reason: "A different reason entirely",
      }),
    );
    expect(second).toMatchObject({
      ok: false,
      code: "SYSTEM_RECOVERY_IDEMPOTENCY_CONFLICT",
    });
  });
});
