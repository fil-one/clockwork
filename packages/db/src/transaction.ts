import { createHmac } from "node:crypto";

import { sql } from "drizzle-orm";

import type { Role, UserId } from "@clockwork/contracts";

import {
  configuredServiceConnectionRole,
  type RuntimeDatabase,
  type RuntimeTransaction,
} from "./client";

export interface DatabaseAuthorizationContext {
  userId: UserId;
  accountIds: readonly string[];
  roles: readonly Role[];
  isInternalStaff: boolean;
  requestId: string;
}

export interface AuthorizationContextSigningOptions {
  secret: string;
  now?: Date;
  lifetimeSeconds?: number;
}

export interface DatabaseTransactionInstrumentation {
  trace<T>(input: {
    kind: "authorized" | "internal";
    requestId: string;
    operation(): Promise<T>;
  }): Promise<T>;
}

let transactionInstrumentation: DatabaseTransactionInstrumentation | undefined;

export function configureDatabaseTransactionInstrumentation(
  instrumentation: DatabaseTransactionInstrumentation,
): void {
  if (
    transactionInstrumentation &&
    transactionInstrumentation !== instrumentation &&
    process.env.NODE_ENV === "production"
  )
    throw new Error("DATABASE_TRANSACTION_INSTRUMENTATION_ALREADY_CONFIGURED");
  transactionInstrumentation = instrumentation;
}

export function resetDatabaseTransactionInstrumentationForTests(): void {
  if (process.env.NODE_ENV === "production")
    throw new Error("DATABASE_TRANSACTION_INSTRUMENTATION_RESET_FORBIDDEN");
  transactionInstrumentation = undefined;
}

function instrumentedTransaction<T>(input: {
  kind: "authorized" | "internal";
  requestId: string;
  operation(): Promise<T>;
}): Promise<T> {
  return transactionInstrumentation
    ? transactionInstrumentation.trace(input)
    : input.operation();
}

export async function withAuthorizedTransaction<T>(
  db: RuntimeDatabase,
  context: DatabaseAuthorizationContext,
  signing: AuthorizationContextSigningOptions,
  operation: (transaction: RuntimeTransaction) => Promise<T>,
): Promise<T> {
  if (signing.secret.length < 32)
    throw new Error("Authorization context secret must be at least 32 bytes");
  const expiresAt = new Date(
    (signing.now ?? new Date()).getTime() +
      (signing.lifetimeSeconds ?? 60) * 1000,
  ).toISOString();
  const payload = JSON.stringify({
    userId: context.userId,
    accountIds: context.accountIds,
    roles: context.roles,
    isInternalStaff: context.isInternalStaff,
    requestId: context.requestId,
    expiresAt,
  });
  const signature = createHmac("sha256", signing.secret)
    .update(payload)
    .digest("hex");
  return instrumentedTransaction({
    kind: "authorized",
    requestId: context.requestId,
    operation: () =>
      db.transaction(async (transaction) => {
        await transaction.execute(sql`set local role clockwork_runtime`);
        await transaction.execute(
          sql`select set_config('app.authorization_context', ${payload}, true)`,
        );
        await transaction.execute(
          sql`select set_config('app.authorization_signature', ${signature}, true)`,
        );
        return operation(transaction);
      }),
  });
}

/**
 * The tenant-facing pool authenticates as this role. It is deliberately not a
 * member of clockwork_service: the only grant in the tree is
 * `grant clockwork_runtime, clockwork_service to postgres`
 * (supabase/migrations/000001_foundation.sql). So `set local role
 * clockwork_service` on that pool raises SQLSTATE 42501, and the grant that
 * would make it succeed is exactly the one that must never exist --
 * `app_is_internal()` is `current_user = 'clockwork_service'`, so membership
 * would hand the tenant pool a standing exit from row-level security.
 */
const RUNTIME_CONNECTION_ROLE = "clockwork_runtime";
const SERVICE_CONNECTION_ROLE = "clockwork_service";
const LOCAL_SUPERUSER_ROLE = "postgres";

/**
 * Raised when an internal transaction is asked to run on a connection that
 * cannot be shown to be the service pool. Never widen this into a grant.
 */
export class InternalTransactionPoolError extends Error {
  public readonly code = "INTERNAL_TRANSACTION_POOL_REJECTED";

  public constructor(
    public readonly connectionRole: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "InternalTransactionPoolError";
  }
}

/**
 * The role a pool authenticates as, read from the connection the drizzle handle
 * was built over. Supavisor tenant usernames are `role.projectref`, so only the
 * leading segment is the role -- the same normalization createRuntimeDatabase()
 * enforces for production connections. postgres-js has already percent-decoded
 * the username, so decoding again here would throw on a literal `%`.
 */
export function internalTransactionConnectionRole(
  db: RuntimeDatabase,
): string | undefined {
  const client = (db as { $client?: { options?: { user?: unknown } } }).$client;
  const user = client?.options?.user;
  if (typeof user !== "string" || user.length === 0) return undefined;
  return user.split(".")[0];
}

/**
 * Remote production admits only the canonical service login. A database built
 * explicitly as the service pool also carries its exact configured login; this
 * supports isolated local release proof and production-like pool-separation
 * tests without accepting a name prefix. The local Supabase superuser and
 * role-less unit-test doubles are otherwise accepted only outside production,
 * where the separate service login does not exist or no database connection
 * exists at all. Every other named role is refused in every environment. This
 * is an allow-list: rejecting only the known tenant role would let a future or
 * misconfigured login attempt `set local role clockwork_service` before this
 * boundary detected it.
 *
 * The check lives inside the helper rather than in a lint over the call sites so
 * that a future call site cannot route around it. Local and CI service handles
 * authenticate as `postgres`, a member of both roles, and are admitted only by
 * their explicit service-pool binding (or the non-production fallback). Remote
 * production still binds only the canonical service login.
 */
export function assertInternalTransactionServicePool(
  db: RuntimeDatabase,
): void {
  const role = internalTransactionConnectionRole(db);
  const configuredRole = configuredServiceConnectionRole(db);
  if (role === SERVICE_CONNECTION_ROLE) return;
  if (configuredRole !== undefined && role === configuredRole) return;
  if (
    process.env.NODE_ENV !== "production" &&
    (role === LOCAL_SUPERUSER_ROLE || role === undefined)
  )
    return;
  const detail =
    role === RUNTIME_CONNECTION_ROLE
      ? `${RUNTIME_CONNECTION_ROLE}, which is not a member of ${SERVICE_CONNECTION_ROLE}. Pass the service pool; do not grant the membership`
      : role === undefined
        ? `no connection role, so it cannot be shown to be the ${SERVICE_CONNECTION_ROLE} pool`
        : `${role}, which is not an allowed internal-transaction connection role`;
  throw new InternalTransactionPoolError(
    role,
    `Internal transaction refused: the handle reports ${detail}`,
  );
}

export async function withInternalTransaction<T>(
  db: RuntimeDatabase,
  requestId: string,
  operation: (transaction: RuntimeTransaction) => Promise<T>,
): Promise<T> {
  assertInternalTransactionServicePool(db);
  return instrumentedTransaction({
    kind: "internal",
    requestId,
    operation: () =>
      db.transaction(async (transaction) => {
        await transaction.execute(sql`set local role clockwork_service`);
        await transaction.execute(
          sql`select set_config('app.request_id', ${requestId}, true)`,
        );
        return operation(transaction);
      }),
  });
}
