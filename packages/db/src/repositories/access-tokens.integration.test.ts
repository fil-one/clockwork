import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createRuntimeDatabase } from "../client";
import { AccessTokenRepository, hashAccessTokenSecret } from "./access-tokens";

const { client, db } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});
const repository = new AccessTokenRepository(db);
const filOneOrganization = "30000000-0000-4000-8000-000000000008";
const person = randomUUID();
const other = randomUUID();
const actor = { kind: "user" as const, id: person, display: "Token Person" };
const admin = { kind: "user" as const, id: other, display: "Admin" };

beforeAll(async () => {
  const tag = person.slice(0, 8);
  await client`insert into commerce_users (id, workos_user_id, email, name, is_internal_staff, mfa_enrolled)
    values (${person}, ${`tokens_${tag}`}, ${`tokens.${tag}@clockwork.test`}, 'Token Person', true, true),
           (${other}, ${`tokens_admin_${tag}`}, ${`tokens.admin.${tag}@clockwork.test`}, 'Admin', true, true)`;
  await client`insert into experience_mfa_receipts
    (challenge_id, session_id, workos_user_id, workos_organization_id, factor_id)
    values (${randomUUID()}, ${`token_session_${tag}`}, ${`tokens_${tag}`}, 'org_token_tests', 'factor_1')`;
});

describe("access tokens after an authenticator change", () => {
  async function fixture() {
    const userId = randomUUID();
    const workosUserId = `factor_${userId}`;
    const workosOrganizationId = "org_token_factor_tests";
    const oldSession = `old_${userId}`;
    const newSession = `new_${userId}`;
    await client`insert into commerce_users
      (id, workos_user_id, email, name, is_internal_staff, mfa_enrolled)
      values (${userId}, ${workosUserId}, ${`${userId}@clockwork.test`}, 'Factor Test', true, true)`;
    const receipt = (factor: string, sessionId: string) =>
      client`insert into experience_mfa_receipts
        (challenge_id, session_id, workos_user_id, workos_organization_id, factor_id)
        values (${randomUUID()}, ${sessionId}, ${workosUserId}, ${workosOrganizationId}, ${factor})`;
    await receipt("factor_old", oldSession);
    return {
      userId,
      oldSession,
      newSession,
      receipt,
      binding: { workosUserId, workosOrganizationId },
      create: (factor = "factor_old") =>
        create({
          userId,
          mfaFactorId: factor,
          actor: { ...actor, id: userId },
        }),
    };
  }

  it("refuses a still-recent old-session receipt and a stale creation request", async () => {
    const user = await fixture();
    const old = await user.create();
    expect(
      await repository.sessionFactor({
        ...user.binding,
        sessionId: user.oldSession,
      }),
    ).toBe("factor_old");

    await user.receipt("factor_new", user.newSession);

    expect(await repository.authenticate(old.secret)).toBeNull();
    expect(
      await repository.sessionFactor({
        ...user.binding,
        sessionId: user.oldSession,
      }),
    ).toBeNull();
    await expect(user.create()).rejects.toThrow("ACCESS_TOKEN_MFA_CHANGED");
    expect(
      await repository.sessionFactor({
        ...user.binding,
        sessionId: user.newSession,
      }),
    ).toBe("factor_new");
    const current = await user.create("factor_new");
    expect(await repository.authenticate(current.secret)).not.toBeNull();

    // Reverification with the current factor keeps its tokens usable.
    await user.receipt("factor_new", user.newSession);
    expect(await repository.authenticate(current.secret)).not.toBeNull();
  });

  it.each(["creation", "receipt"] as const)(
    "serializes a concurrent creation and factor change with %s first",
    async (first) => {
      const user = await fixture();
      const key = `access_tokens:${user.userId}`;
      const waitForWaiters = (count: number) =>
        vi.waitFor(async () => {
          const [row] = await client<{ count: number }[]>`
            select count(*)::int as count from pg_locks
            where locktype = 'advisory' and not granted
              and classid = ((hashtextextended(${key}, 0) >> 32) & 4294967295)::oid
              and objid = (hashtextextended(${key}, 0) & 4294967295)::oid`;
          expect(row?.count).toBe(count);
        });
      type Creation = Awaited<ReturnType<typeof create>>;
      let pendingCreate: Promise<Creation | Error> | undefined;
      let pendingReceipt: Promise<unknown> | undefined;
      const startCreation = () => {
        pendingCreate = user.create().catch((error: unknown) => {
          if (error instanceof Error) return error;
          throw error;
        });
      };
      const startReceipt = () => {
        pendingReceipt = user
          .receipt("factor_new", user.newSession)
          .then(() => {});
      };
      // Hold the shared lock, then queue both real operations in a known
      // order. Inspect lock waiters instead of guessing with sleep timings.
      await client.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
        if (first === "creation") startCreation();
        else startReceipt();
        await waitForWaiters(1);
        if (first === "creation") startReceipt();
        else startCreation();
        await waitForWaiters(2);
      });
      const [created] = await Promise.all([pendingCreate, pendingReceipt]);
      if (first === "receipt") {
        expect(created).toBeInstanceOf(Error);
        expect((created as Error).message).toBe("ACCESS_TOKEN_MFA_CHANGED");
      } else {
        expect(created).not.toBeInstanceOf(Error);
        if (!created || created instanceof Error)
          throw new Error("Creation failed");
        expect(await repository.authenticate(created.secret)).toBeNull();
        const [revocation] = await client<{ revoked_reason: string }[]>`
          select revoked_reason from commerce_access_tokens where id = ${created.record.id}`;
        expect(revocation?.revoked_reason).toBe("mfa_reset");
      }
      const current = await user.create("factor_new");
      expect(await repository.authenticate(current.secret)).not.toBeNull();
    },
  );
});

afterAll(() => client.end());

const create = (
  overrides: Partial<Parameters<typeof repository.create>[0]> = {},
) =>
  repository.create({
    userId: person,
    organizationId: filOneOrganization,
    name: "Claude Code",
    scope: "read_write",
    expiresInDays: 90,
    mfaFactorId: "factor_1",
    actor,
    ...overrides,
  });

describe("AccessTokenRepository", () => {
  it("stores only the hash and audits the creation", async () => {
    const { record, secret } = await create();
    expect(record).toMatchObject({
      userId: person,
      scope: "read_write",
      prefix: secret.slice(0, 11),
      revokedAt: null,
    });
    expect(Date.parse(record.expiresAt) - Date.parse(record.createdAt)).toBe(
      90 * 86_400_000,
    );
    const [row] = await client<{ token_hash: Buffer }[]>`
      select token_hash from commerce_access_tokens where id = ${record.id}`;
    expect(row?.token_hash.equals(hashAccessTokenSecret(secret))).toBe(true);
    const [event] = await client<{ event_type: string; after: unknown }[]>`
      select event_type, after from audit_events
      where aggregate_type = 'access_token' and aggregate_id = ${record.id}`;
    expect(event?.event_type).toBe("access_token.created");
    expect(JSON.stringify(event?.after)).not.toContain(secret);
  });

  it("authenticates a live secret, counts it and marks it used", async () => {
    const { record, secret } = await create({ scope: "read" });
    const first = await repository.authenticate(secret);
    const second = await repository.authenticate(secret);
    expect(first).toMatchObject({
      id: record.id,
      scope: "read",
      windowCount: 1,
    });
    expect(second?.windowCount).toBe(2);
    expect(second?.windowResetSeconds).toBeGreaterThan(0);
    const [listed] = (await repository.list(person)).filter(
      ({ id }) => id === record.id,
    );
    expect(listed?.lastUsedAt).not.toBeNull();
    expect(await repository.authenticate(`${secret.slice(0, -1)}x`)).toBeNull();
    expect(await repository.authenticate("not a token")).toBeNull();
  });

  it("does not authenticate an expired token", async () => {
    const { record, secret } = await create({
      expiresInDays: 1,
      now: new Date(Date.now() - 2 * 86_400_000),
    });
    expect(await repository.authenticate(secret)).toBeNull();
    expect((await repository.list(person)).map(({ id }) => id)).toContain(
      record.id,
    );
  });

  it("revokes for its owner or an administrator of the organization only", async () => {
    const { record, secret } = await create();
    await expect(
      repository.revoke({
        id: record.id,
        actor: admin,
        reason: "owner",
        ownerId: other,
      }),
    ).rejects.toThrow("ACCESS_TOKEN_NOT_FOUND");
    await expect(
      repository.revoke({
        id: record.id,
        actor: admin,
        reason: "admin",
        organizationId: randomUUID(),
      }),
    ).rejects.toThrow("ACCESS_TOKEN_NOT_FOUND");
    const revoked = await repository.revoke({
      id: record.id,
      actor: admin,
      reason: "admin",
      organizationId: filOneOrganization,
    });
    expect(revoked.revokedReason).toBe("admin");
    expect(await repository.authenticate(secret)).toBeNull();
    // A second revocation changes and records nothing.
    await repository.revoke({
      id: record.id,
      actor,
      reason: "owner",
      ownerId: person,
    });
    const events = await client<{ event_type: string; actor_id: string }[]>`
      select event_type, actor->>'id' as actor_id from audit_events
      where aggregate_type = 'access_token' and aggregate_id = ${record.id}
      order by aggregate_version`;
    expect(events).toEqual([
      { event_type: "access_token.created", actor_id: person },
      { event_type: "access_token.revoked", actor_id: other },
    ]);
    const admins = await repository.listForOrganization(filOneOrganization);
    expect(admins.find(({ id }) => id === record.id)).toMatchObject({
      userName: "Token Person",
      revokedReason: "admin",
    });
  });

  it("records each tool call against its token", async () => {
    const { record } = await create();
    await repository.recordToolCall({
      tokenId: record.id,
      actor,
      tool: "list_mndas",
      outcome: "ok",
      targets: { mndaId: "m1" },
      requestId: randomUUID(),
    });
    const [event] = await client<{ version: number; metadata: unknown }[]>`
      select aggregate_version as version, metadata from audit_events
      where aggregate_type = 'access_token' and aggregate_id = ${record.id}
        and event_type = 'mcp.tool_called'`;
    expect(event).toEqual({
      version: 2,
      metadata: {
        channel: "mcp",
        tokenId: record.id,
        tool: "list_mndas",
        outcome: "ok",
        targets: { mndaId: "m1" },
      },
    });
  });

  it("holds a person to 20 live tokens", async () => {
    const existing = (await repository.list(person)).filter(
      ({ revokedAt, expiresAt }) =>
        revokedAt === null && Date.parse(expiresAt) > Date.now(),
    ).length;
    for (let index = existing; index < 20; index += 1)
      await create({ name: `Token ${index}`, scope: "read" });
    await expect(create({ name: "One too many" })).rejects.toThrow(
      "ACCESS_TOKEN_LIMIT",
    );
  });
});
