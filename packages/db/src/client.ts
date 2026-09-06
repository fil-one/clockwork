import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { runtimeSchema } from "./schema/index";

export interface RuntimeDatabaseOptions {
  url: string;
  maxConnections?: number;
  role?: "clockwork_runtime" | "clockwork_service";
  ssl?: "require" | false;
}

interface RuntimeDatabaseRoleBinding {
  applicationRole: "clockwork_runtime" | "clockwork_service";
  connectionRole: string;
}

const runtimeDatabaseRoleBindings = new WeakMap<
  object,
  RuntimeDatabaseRoleBinding
>();

/**
 * Runtime connections target Supavisor transaction mode. Transaction pooling does
 * not preserve session state, so prepared statements are intentionally disabled.
 */
export function createRuntimeDatabase(options: RuntimeDatabaseOptions): {
  client: postgres.Sql;
  db: RuntimeDatabase;
} {
  const parsedUrl = new URL(options.url);
  const local = ["127.0.0.1", "localhost", "::1"].includes(parsedUrl.hostname);
  const expectedRole = options.role ?? "clockwork_runtime";
  const connectionRole =
    decodeURIComponent(parsedUrl.username).split(".")[0] ?? "";
  if (
    process.env.NODE_ENV === "production" &&
    !local &&
    connectionRole !== expectedRole
  )
    throw new Error(
      `Production ${expectedRole} connections must authenticate as ${expectedRole}`,
    );
  const client = postgres(options.url, {
    max: options.maxConnections ?? 5,
    prepare: false,
    ssl: options.ssl ?? (local ? false : "require"),
    idle_timeout: 20,
    connect_timeout: 10,
  });

  const db = drizzle(client, { schema: runtimeSchema });
  runtimeDatabaseRoleBindings.set(db, {
    applicationRole: expectedRole,
    connectionRole,
  });
  return { client, db };
}

export type RuntimeDatabase = PostgresJsDatabase<typeof runtimeSchema> & {
  $client: postgres.Sql;
};
export type RuntimeTransaction = Parameters<
  Parameters<RuntimeDatabase["transaction"]>[0]
>[0];

/**
 * Returns the exact login role bound to a database explicitly constructed as
 * the service pool. Local release-proof databases and pool-separation tests
 * may use a deployment-owned login other than `clockwork_service`; the role is
 * never inferred from a prefix, and a runtime-pool handle has no service
 * binding even if both URLs happen to name the same local superuser.
 */
export function configuredServiceConnectionRole(
  db: RuntimeDatabase,
): string | undefined {
  const binding = runtimeDatabaseRoleBindings.get(db);
  return binding?.applicationRole === "clockwork_service"
    ? binding.connectionRole
    : undefined;
}
