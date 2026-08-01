import { createHmac } from "node:crypto";

import { sql } from "drizzle-orm";

import type { Role, UserId } from "@clockwork/contracts";

import type { RuntimeDatabase, RuntimeTransaction } from "./client";

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

export async function withInternalTransaction<T>(
  db: RuntimeDatabase,
  requestId: string,
  operation: (transaction: RuntimeTransaction) => Promise<T>,
): Promise<T> {
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
