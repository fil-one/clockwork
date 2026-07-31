import { createHmac } from "node:crypto";

import postgres from "postgres";

export interface TestDatabaseContext {
  sql: postgres.Sql;
  setAuthorization(input: {
    userId: string;
    accountIds: readonly string[];
    roles?: readonly string[];
    isInternal?: boolean;
  }): Promise<void>;
}

export async function withSupabaseRollback<T>(
  operation: (context: TestDatabaseContext) => Promise<T>,
  url = process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
) {
  const sql = postgres(url, { max: 1, prepare: false, ssl: false });
  await sql.unsafe("begin");
  try {
    const result = await operation({
      sql,
      setAuthorization: async ({
        userId,
        accountIds,
        roles = ["member"],
        isInternal = false,
      }) => {
        if (isInternal) {
          await sql.unsafe("set local role clockwork_service");
          return;
        }
        const secret =
          process.env.AUTHORIZATION_CONTEXT_SECRET ??
          "clockwork-local-auth-context-secret-change-me";
        const payload = JSON.stringify({
          userId,
          accountIds,
          roles,
          isInternalStaff: false,
          requestId: "test-rollback-context",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
        const signature = createHmac("sha256", secret)
          .update(payload)
          .digest("hex");
        await sql`select set_config('app.authorization_context', ${payload}, true)`;
        await sql`select set_config('app.authorization_signature', ${signature}, true)`;
        await sql.unsafe("set local role clockwork_runtime");
      },
    });
    return result;
  } finally {
    await sql.unsafe("rollback");
    await sql.end();
  }
}
