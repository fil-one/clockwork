import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";

import { createRuntimeDatabase } from "../../client";
import { priceBooks } from "../../schema";
import { withInternalTransaction } from "../../transaction";
import { DatabaseCoreFinanceRepository } from "./database-finance";

/**
 * Every other test in this package builds the repository with
 * `database: db, pricingDatabase: db` over one superuser connection. That
 * connection is a member of both roles, so `set local role clockwork_service`
 * always succeeds and a command routed to the wrong pool looks identical to one
 * routed to the right pool.
 *
 * This file reproduces production instead: two login roles, one a member of
 * clockwork_runtime only and one a member of clockwork_service only, exactly the
 * separation `grant clockwork_runtime, clockwork_service to postgres` withholds
 * from the application logins. The roles are created here rather than by a
 * migration because login provisioning is deployment-owned; they are dropped
 * again in afterAll.
 */
const superuserUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";

const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const runtimeRole = `cw_pool_runtime_${suffix}`;
const serviceRole = `cw_pool_service_${suffix}`;
const password = `pool_${suffix}`;

function urlFor(role: string): string {
  const url = new URL(superuserUrl);
  url.username = role;
  url.password = password;
  return url.toString();
}

const superuser = createRuntimeDatabase({
  url: superuserUrl,
  maxConnections: 2,
  role: "clockwork_service",
  ssl: false,
});

let runtimePool: ReturnType<typeof createRuntimeDatabase>;
let servicePool: ReturnType<typeof createRuntimeDatabase>;
let repository: DatabaseCoreFinanceRepository;

const proposerId = "20000000-0000-4000-8000-000000000001";
const financeAuthority = (userId: string): AuthorizationContext => ({
  userId: ids.user.parse(userId),
  accountIds: [],
  roles: ["finance_approver"],
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: true,
});

// Published version is unique per currency and price books are never deleted,
// so this run claims its own band the way the sibling suite does.
const versionBase =
  2_000_000 + (Number.parseInt(suffix.slice(0, 6), 16) % 900_000);

beforeAll(async () => {
  await superuser.client.unsafe(
    `create role "${runtimeRole}" login password '${password}' noinherit nobypassrls in role clockwork_runtime`,
  );
  await superuser.client.unsafe(
    `create role "${serviceRole}" login password '${password}' noinherit nobypassrls in role clockwork_service`,
  );
  runtimePool = createRuntimeDatabase({
    url: urlFor(runtimeRole),
    maxConnections: 2,
    role: "clockwork_runtime",
    ssl: false,
  });
  servicePool = createRuntimeDatabase({
    url: urlFor(serviceRole),
    maxConnections: 2,
    role: "clockwork_service",
    ssl: false,
  });
  repository = new DatabaseCoreFinanceRepository({
    database: runtimePool.db,
    pricingDatabase: servicePool.db,
    authorizationSecret,
  });
});

afterAll(async () => {
  await runtimePool?.client.end();
  await servicePool?.client.end();
  await superuser.client.unsafe(`drop role if exists "${runtimeRole}"`);
  await superuser.client.unsafe(`drop role if exists "${serviceRole}"`);
  await superuser.client.end();
});

/** Drizzle wraps driver failures, so walk the cause chain rather than the top. */
function chain(error: unknown): readonly Error[] {
  const links: Error[] = [];
  let current: unknown = error;
  while (current instanceof Error && links.length < 10) {
    links.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return links;
}

function sqlstateChain(error: unknown): readonly string[] {
  return chain(error)
    .map((link) => (link as { code?: unknown }).code)
    .filter((code): code is string => typeof code === "string");
}

function messageChain(error: unknown): string {
  return chain(error)
    .map((link) => link.message)
    .join(" | ");
}

describe.sequential("core finance commands and the two database pools", () => {
  it("cannot assume the service role from the tenant pool", async () => {
    // The negative control. If this ever passes, the pools in this file are not
    // separated and nothing below proves anything -- and if it passes because
    // somebody granted clockwork_runtime membership in clockwork_service, the
    // tenant pool has a standing exit from row-level security, because
    // app_is_internal() is current_user = 'clockwork_service'.
    const denied: unknown = await runtimePool.db
      .transaction(async (transaction) => {
        await transaction.execute(sql`set local role clockwork_service`);
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(denied).toBeInstanceOf(Error);
    expect(sqlstateChain(denied)).toContain("42501");
    expect(messageChain(denied)).toMatch(
      /permission denied to set role "clockwork_service"/,
    );
  });

  it("still admits the runtime role on the tenant pool", async () => {
    await expect(
      runtimePool.db.transaction(async (transaction) => {
        await transaction.execute(sql`set local role clockwork_runtime`);
        return "ok";
      }),
    ).resolves.toBe("ok");
  });

  it("writes a price book with the tenant pool wired as options.database", async () => {
    const id = randomUUID();
    const version = versionBase + 1;

    const created = await repository.mutate({
      resource: "price_books",
      id,
      action: "create",
      payload: {
        name: `Pool separation rate card ${version}`,
        currency: "GBP",
        effectiveFrom: "2026-01-01",
        version,
      },
      actor: { kind: "user", id: proposerId },
      authorization: financeAuthority(proposerId),
      requestId: `pool-separation-create-${suffix}`,
      idempotencyKey: `pool-separation-create-${suffix}`,
      occurredAt: "2026-08-01T16:00:00.000Z",
    });

    expect(created.record.data).toMatchObject({ status: "draft" });
    const persisted = await withInternalTransaction(
      servicePool.db,
      `pool-separation-read-${suffix}`,
      (transaction) =>
        transaction.query.priceBooks.findFirst({
          where: eq(priceBooks.id, id),
        }),
    );
    expect(persisted).toMatchObject({ status: "draft" });
  });
});
