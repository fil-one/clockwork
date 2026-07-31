import postgres from "postgres";

/** Direct owner connections are exported only on the tooling-specific path. */
export function createDirectMigrationClient(url: string) {
  return postgres(url, {
    max: 1,
    prepare: false,
    ssl: new URL(url).hostname === "127.0.0.1" ? false : "require",
  });
}
