import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { runtimeSchema } from "./schema/index";

export interface RuntimeDatabaseOptions {
  url: string;
  maxConnections?: number;
  role?: "clockwork_runtime" | "clockwork_service";
  ssl?: "require" | false;
}

/**
 * Runtime connections target Supavisor transaction mode. Transaction pooling does
 * not preserve session state, so prepared statements are intentionally disabled.
 */
export function createRuntimeDatabase(options: RuntimeDatabaseOptions) {
  const parsedUrl = new URL(options.url);
  const local = ["127.0.0.1", "localhost", "::1"].includes(parsedUrl.hostname);
  const expectedRole = options.role ?? "clockwork_runtime";
  const connectionRole = decodeURIComponent(parsedUrl.username).split(".")[0];
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

  return { client, db: drizzle(client, { schema: runtimeSchema }) };
}

export type RuntimeDatabase = ReturnType<typeof createRuntimeDatabase>["db"];
export type RuntimeTransaction = Parameters<
  Parameters<RuntimeDatabase["transaction"]>[0]
>[0];
