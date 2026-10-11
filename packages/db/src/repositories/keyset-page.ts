import { sql, type SQLWrapper } from "drizzle-orm";
import { z } from "zod";

export interface KeysetPageOptions {
  limit?: number;
  cursor?: string;
}

const cursorSchema = z
  .object({
    source: z.string(),
    at: z.iso.datetime(),
    id: z.uuid(),
  })
  .strict();
export type KeysetCursor = z.infer<typeof cursorSchema>;

/** Opaque cursors retain PostgreSQL microseconds, never round through Date. */
export function pageOptions(source: string, options: KeysetPageOptions = {}) {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("INVALID_INPUT");
  let cursor: KeysetCursor | undefined;
  if (options.cursor !== undefined) {
    try {
      if (!/^[A-Za-z0-9_-]{1,500}$/u.test(options.cursor))
        throw new Error("INVALID_INPUT");
      cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8")),
      );
      if (cursor.source !== source) throw new Error("INVALID_INPUT");
    } catch {
      throw new Error("INVALID_INPUT");
    }
  }
  return { limit, cursor };
}

export const cursorTimestamp = (column: SQLWrapper) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export const beforeCursor = (
  at: SQLWrapper,
  id: SQLWrapper,
  cursor: KeysetCursor | undefined,
) =>
  cursor
    ? sql`(${at}, ${id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
    : undefined;

export function nextPageCursor(
  source: string,
  hasMore: boolean,
  last: { id: string; cursorAt: string } | undefined,
) {
  return hasMore && last
    ? Buffer.from(
        JSON.stringify({ source, at: last.cursorAt, id: last.id }),
      ).toString("base64url")
    : null;
}
