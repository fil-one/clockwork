import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase, withInternalTransaction } from "@clockwork/db";

import {
  createAssistedSession,
  endAssistedSession,
  resolveAssistedSession,
} from "./repository";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authenticationSessionPrefix = "integration-assisted-auth-session:";
const concurrentAuthenticationSessionId = `${authenticationSessionPrefix}concurrent`;
const durabilityAuthenticationSessionId = `${authenticationSessionPrefix}durability`;
const expiryAuthenticationSessionId = `${authenticationSessionPrefix}expiry`;
const internalUserId = "20000000-0000-4000-8000-000000000001";
const targetAccountId = "10000000-0000-4000-8000-000000000001";
const alternateAccountId = "10000000-0000-4000-8000-000000000004";
const requestPrefix = "integration:experience-assisted";
const baseline = new Date("2030-07-31T16:00:00.000Z");

interface RoleRow extends Record<string, unknown> {
  role: string;
}

interface ActorProfileRow extends Record<string, unknown> {
  name: string;
  email: string;
}

interface AuditActorRow extends Record<string, unknown> {
  actor: { display?: string };
}

interface ExpiryEvidenceRow extends Record<string, unknown> {
  ended_at: Date | string | null;
  event_type: string | null;
}

function databaseErrorEvidence(error: unknown): {
  messages: string[];
  codes: string[];
} {
  const messages: string[] = [];
  const codes: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (current && !visited.has(current)) {
    visited.add(current);
    if (current instanceof Error) messages.push(current.message);
    if (typeof current !== "object") break;
    const record = current as Record<string, unknown>;
    if (typeof record.code === "string") codes.push(record.code);
    current = record.cause;
  }
  return { messages, codes };
}

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 4,
  role: "clockwork_service",
  ssl: false,
});

async function cleanup() {
  // The local integration URL authenticates as the database owner. Cleanup is
  // intentionally outside the service-role transaction used by production.
  // Audit/outbox rows are append-only evidence and must never be test-deleted.
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      delete from public.experience_assisted_sessions
      where authentication_session_id like ${`${authenticationSessionPrefix}%`}
    `);
  });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await client.end();
});

describe.sequential("persistent assisted-session identity", () => {
  it("permits only one concurrent live session and reads it back after reload", async () => {
    const attempts = await Promise.allSettled([
      createAssistedSession(db, {
        authenticationSessionId: concurrentAuthenticationSessionId,
        internalUserId,
        targetAccountId,
        reason: "Customer requested a quote correction in case CASE-4812",
        requestId: `${requestPrefix}:concurrent-a`,
        now: baseline,
      }),
      createAssistedSession(db, {
        authenticationSessionId: concurrentAuthenticationSessionId,
        internalUserId,
        targetAccountId: alternateAccountId,
        reason: "Customer requested an order correction in case CASE-4813",
        requestId: `${requestPrefix}:concurrent-b`,
        now: baseline,
      }),
    ]);
    const fulfilled = attempts.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof createAssistedSession>>
      > => result.status === "fulfilled",
    );
    const rejected = attempts.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const created = fulfilled[0]?.value;
    if (!created) throw new Error("Expected one assisted session");
    await expect(
      resolveAssistedSession(db, {
        id: created.id,
        authenticationSessionId: concurrentAuthenticationSessionId,
        internalUserId,
        requestId: `${requestPrefix}:reload-readback`,
        now: new Date(baseline.getTime() + 1_000),
      }),
    ).resolves.toMatchObject({
      id: created.id,
      actualUserId: internalUserId,
      targetAccountId: created.targetAccountId,
      reason: created.reason,
    });
  });

  it("rechecks role authority on every resolve and makes exit durable", async () => {
    const durable = await createAssistedSession(db, {
      authenticationSessionId: durabilityAuthenticationSessionId,
      internalUserId,
      targetAccountId,
      reason: "Customer requested durable assisted help in case CASE-4818",
      requestId: `${requestPrefix}:durability-create`,
      now: baseline,
    });
    const id = durable.id;

    const beforeMutation = await resolveAssistedSession(db, {
      id,
      authenticationSessionId: durabilityAuthenticationSessionId,
      internalUserId,
      requestId: `${requestPrefix}:actor-snapshot-before`,
      now: new Date(baseline.getTime() + 1_500),
    });
    const originalProfiles = await db.execute<ActorProfileRow>(sql`
      select name, email from public.commerce_users
      where id = ${internalUserId}::uuid
    `);
    const originalProfile = originalProfiles[0];
    if (!originalProfile) throw new Error("Internal actor profile is missing");
    let immutableError: unknown;
    try {
      await db.execute(sql`
        update public.experience_assisted_sessions
        set actor_snapshot_name = 'Tampered actor'
        where id = ${id}::uuid
      `);
    } catch (error) {
      immutableError = error;
    }
    const immutableEvidence = databaseErrorEvidence(immutableError);
    expect(immutableEvidence.codes).toContain("23514");
    expect(immutableEvidence.messages).toContain(
      "assisted session identity is immutable",
    );
    await db.execute(sql`
      update public.commerce_users
      set name = 'Changed Directory Name', email = 'changed-directory@filone.com'
      where id = ${internalUserId}::uuid
    `);
    try {
      await expect(
        resolveAssistedSession(db, {
          id,
          authenticationSessionId: durabilityAuthenticationSessionId,
          internalUserId,
          requestId: `${requestPrefix}:actor-snapshot-after`,
          now: new Date(baseline.getTime() + 1_750),
        }),
      ).resolves.toMatchObject({
        actualActorName: beforeMutation.actualActorName,
        actualActorEmail: beforeMutation.actualActorEmail,
      });
    } finally {
      await db.execute(sql`
        update public.commerce_users
        set name = ${originalProfile.name}, email = ${originalProfile.email}
        where id = ${internalUserId}::uuid
      `);
    }

    const membershipId = "31000000-0000-4000-8000-000000000003";
    const original = await withInternalTransaction(
      db,
      `${requestPrefix}:snapshot-role`,
      (tx) =>
        tx.execute<RoleRow>(sql`
          select role from public.memberships
          where id = ${membershipId}::uuid and user_id = ${internalUserId}::uuid
        `),
    );
    const originalRole = original[0]?.role;
    if (!originalRole)
      throw new Error("Internal fixture membership is missing");
    await withInternalTransaction(db, `${requestPrefix}:revoke-role`, (tx) =>
      tx.execute(sql`
        update public.memberships set role = 'member'
        where id = ${membershipId}::uuid and user_id = ${internalUserId}::uuid
      `),
    );
    try {
      await expect(
        resolveAssistedSession(db, {
          id,
          authenticationSessionId: durabilityAuthenticationSessionId,
          internalUserId,
          requestId: `${requestPrefix}:revoked-read`,
          now: new Date(baseline.getTime() + 2_000),
        }),
      ).rejects.toThrow("Actual actor lacks assisted-action permission");
    } finally {
      await withInternalTransaction(db, `${requestPrefix}:restore-role`, (tx) =>
        tx.execute(sql`
            update public.memberships set role = ${originalRole}
            where id = ${membershipId}::uuid and user_id = ${internalUserId}::uuid
          `),
      );
    }

    await expect(
      endAssistedSession(db, {
        id,
        authenticationSessionId: durabilityAuthenticationSessionId,
        internalUserId,
        requestId: `${requestPrefix}:exit`,
        now: new Date(baseline.getTime() + 3_000),
      }),
    ).resolves.toBe("ended");
    await expect(
      resolveAssistedSession(db, {
        id,
        authenticationSessionId: durabilityAuthenticationSessionId,
        internalUserId,
        requestId: `${requestPrefix}:after-exit`,
        now: new Date(baseline.getTime() + 4_000),
      }),
    ).rejects.toThrow("No active assisted-action authorization exists");
    await expect(
      endAssistedSession(db, {
        id,
        authenticationSessionId: durabilityAuthenticationSessionId,
        internalUserId,
        requestId: `${requestPrefix}:duplicate-exit`,
        now: new Date(baseline.getTime() + 5_000),
      }),
    ).resolves.toBe("already-ended");
    const audit = await withInternalTransaction(
      db,
      `${requestPrefix}:exit-audit-readback`,
      (tx) =>
        tx.execute<AuditActorRow>(sql`
          select actor from public.audit_events
          where aggregate_id = ${id}::uuid
            and event_type = 'security.assisted_action.ended'
        `),
    );
    expect(audit[0]?.actor.display).toBe(beforeMutation.actualActorEmail);
  });

  it("expires on the server and atomically retires expiry before replacement", async () => {
    const expired = await createAssistedSession(db, {
      authenticationSessionId: expiryAuthenticationSessionId,
      internalUserId,
      targetAccountId,
      reason: "Customer requested temporary evidence help in case CASE-4814",
      requestId: `${requestPrefix}:expiring-create`,
      now: baseline,
      durationMinutes: 1,
    });
    const afterExpiry = new Date(baseline.getTime() + 61_000);
    await expect(
      resolveAssistedSession(db, {
        id: expired.id,
        authenticationSessionId: expiryAuthenticationSessionId,
        internalUserId,
        requestId: `${requestPrefix}:expired-read`,
        now: afterExpiry,
      }),
    ).rejects.toThrow("No active assisted-action authorization exists");
    const expiryEvidence = await withInternalTransaction(
      db,
      `${requestPrefix}:expiry-audit-readback`,
      (tx) =>
        tx.execute<ExpiryEvidenceRow>(sql`
          select s.ended_at, e.event_type
          from public.experience_assisted_sessions s
          left join public.audit_events e
            on e.aggregate_id = s.id
           and e.aggregate_version = 2
          where s.id = ${expired.id}::uuid
        `),
    );
    expect(new Date(expiryEvidence[0]?.ended_at ?? Number.NaN)).toEqual(
      afterExpiry,
    );
    expect(expiryEvidence[0]?.event_type).toBe(
      "security.assisted_action.expired",
    );

    await expect(
      createAssistedSession(db, {
        authenticationSessionId: expiryAuthenticationSessionId,
        internalUserId,
        targetAccountId: alternateAccountId,
        reason: "Customer requested temporary order help in case CASE-4815",
        requestId: `${requestPrefix}:replacement-create`,
        now: afterExpiry,
      }),
    ).resolves.toMatchObject({ targetAccountId: alternateAccountId });
  });
});
