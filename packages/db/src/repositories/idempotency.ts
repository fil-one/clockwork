import { and, eq, isNull, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { RuntimeTransaction } from "../client";
import { idempotencyRecords } from "../schema";

export interface StoredIdempotencyResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export async function claimIdempotencyKey(
  transaction: RuntimeTransaction,
  input: {
    scope: string;
    key: string;
    requestHash: string;
    now: Date;
    lockSeconds?: number;
    ttlHours?: number;
  },
) {
  const existing = await transaction.query.idempotencyRecords.findFirst({
    where: and(
      eq(idempotencyRecords.scope, input.scope),
      eq(idempotencyRecords.key, input.key),
    ),
  });

  if (existing) {
    if (existing.requestHash !== input.requestHash)
      return { kind: "conflict" as const };
    if (existing.completedAt && existing.responseStatus !== null) {
      return {
        kind: "replay" as const,
        response: {
          status: existing.responseStatus,
          headers: (existing.responseHeaders ?? {}) as Record<string, string>,
          body: existing.responseBody,
        },
      };
    }
    if (existing.lockedUntil > input.now)
      return { kind: "in_progress" as const };
  }

  const lockUntil = new Date(
    input.now.getTime() + (input.lockSeconds ?? 30) * 1000,
  );
  const expiresAt = new Date(
    input.now.getTime() + (input.ttlHours ?? 24) * 3_600_000,
  );
  const lockToken = randomUUID();
  const [claimed] = existing
    ? await transaction
        .update(idempotencyRecords)
        .set({ lockedUntil: lockUntil, lockToken })
        .where(
          and(
            eq(idempotencyRecords.id, existing.id),
            lt(idempotencyRecords.lockedUntil, input.now),
          ),
        )
        .returning()
    : await transaction
        .insert(idempotencyRecords)
        .values({
          scope: input.scope,
          key: input.key,
          requestHash: input.requestHash,
          lockToken,
          lockedUntil: lockUntil,
          expiresAt,
        })
        .onConflictDoNothing()
        .returning();

  return claimed
    ? { kind: "claimed" as const, id: claimed.id, lockToken }
    : { kind: "in_progress" as const };
}

export async function completeIdempotencyKey(
  transaction: RuntimeTransaction,
  identity: {
    scope: string;
    key: string;
    requestHash: string;
    lockToken: string;
  },
  response: StoredIdempotencyResponse,
) {
  const updated = await transaction
    .update(idempotencyRecords)
    .set({
      responseStatus: response.status,
      responseHeaders: response.headers,
      responseBody: response.body,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(idempotencyRecords.scope, identity.scope),
        eq(idempotencyRecords.key, identity.key),
        eq(idempotencyRecords.requestHash, identity.requestHash),
        eq(idempotencyRecords.lockToken, identity.lockToken),
        isNull(idempotencyRecords.completedAt),
      ),
    )
    .returning({ id: idempotencyRecords.id });
  if (updated.length !== 1)
    throw new Error("Stale idempotency lease cannot complete a response");
}

/**
 * Abandon a claim without recording an outcome, so the same key and the same
 * request bytes are immediately retryable. The row is kept rather than deleted:
 * it is what makes a *different* body under the same key still conflict, so
 * releasing cannot be used to launder a changed payload. Expiring the lock is
 * enough because `claimIdempotencyKey` already re-claims a row whose lock has
 * lapsed.
 */
export async function releaseIdempotencyKey(
  transaction: RuntimeTransaction,
  identity: {
    scope: string;
    key: string;
    requestHash: string;
    lockToken: string;
  },
  now: Date = new Date(),
): Promise<void> {
  await transaction
    .update(idempotencyRecords)
    .set({ lockedUntil: new Date(now.getTime() - 1000) })
    .where(
      and(
        eq(idempotencyRecords.scope, identity.scope),
        eq(idempotencyRecords.key, identity.key),
        eq(idempotencyRecords.requestHash, identity.requestHash),
        eq(idempotencyRecords.lockToken, identity.lockToken),
        isNull(idempotencyRecords.completedAt),
      ),
    );
}
