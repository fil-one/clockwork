import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";

import {
  accessTokenLiveLimit,
  accessTokenSecretPrefix,
  type AccessTokenAdminRecord,
  type AccessTokenRecord,
  type AccessTokenScope,
  type Actor,
} from "@clockwork/contracts";

import type { RuntimeDatabase, RuntimeTransaction } from "../client";
import { commerceUsers } from "../schema";
import { commerceAccessTokens } from "../schema/access-tokens";
import { withInternalTransaction } from "../transaction";
import { appendAuditAndOutbox } from "./audit-outbox";

type TokenRow = typeof commerceAccessTokens.$inferSelect;
type UserActor = Actor & { kind: "user" };

/** 32 random bytes, base64url: 43 characters after the prefix. */
const secretPattern = new RegExp(
  `^${accessTokenSecretPrefix}[A-Za-z0-9_-]{43}$`,
  "u",
);

/** A new secret. It is shown once and never stored. */
export function generateAccessTokenSecret(): string {
  return `${accessTokenSecretPrefix}${randomBytes(32).toString("base64url")}`;
}

/** Whether a presented value has the shape of a secret this server issues. */
export function isAccessTokenSecret(value: string): boolean {
  return secretPattern.test(value);
}

/** The stored form of a secret. */
export function hashAccessTokenSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

/** What a person sees to tell tokens apart: the prefix and four characters. */
export function accessTokenDisplayPrefix(secret: string): string {
  return secret.slice(0, accessTokenSecretPrefix.length + 4);
}

function record(row: TokenRow): AccessTokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    scope: row.scope,
    prefix: row.tokenPrefix,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedReason: row.revokedReason ?? null,
  };
}

/** A token that authenticated a request, and whether it is over its limit. */
export interface AuthenticatedAccessToken {
  id: string;
  userId: string;
  organizationId: string;
  name: string;
  scope: AccessTokenScope;
  expiresAt: string;
  /** Requests in the current one-minute window, this one included. */
  windowCount: number;
  /** Seconds until the window resets. */
  windowResetSeconds: number;
}

export interface AccessTokenToolCall {
  tokenId: string;
  actor: UserActor;
  tool: string;
  outcome: "ok" | "refused" | "failed";
  /** The refusal or failure code, never a message with record details. */
  code?: string;
  /** The ids the call named, so the trail can be followed. */
  targets?: Record<string, string>;
  /** The HTTP status when the transport refused the request. */
  httpStatus?: number;
  requestId: string;
}

/**
 * Staff personal access tokens (001480). Creating and revoking write
 * `access_token.*` audit events in the same transaction; each MCP tool call
 * writes `mcp.tool_called` against its token, advancing the token's version.
 * The web layer decides who may create, list and revoke; the service role does
 * not narrow rows.
 */
export class AccessTokenRepository {
  constructor(private readonly db: RuntimeDatabase) {}

  private tx<T>(fn: (tx: RuntimeTransaction) => Promise<T>) {
    return withInternalTransaction(this.db, randomUUID(), fn);
  }

  /** Creates a token and returns its secret, which is not kept. */
  create(input: {
    userId: string;
    organizationId: string;
    name: string;
    scope: AccessTokenScope;
    expiresInDays: number;
    mfaFactorId: string | null;
    actor: UserActor;
    now?: Date;
  }): Promise<{ record: AccessTokenRecord; secret: string }> {
    const now = input.now ?? new Date();
    return this.tx(async (tx) => {
      // One person's tokens are created one at a time, so the limit holds.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`access_tokens:${input.userId}`}, 0))`,
      );
      const [live] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(commerceAccessTokens)
        .where(
          and(
            eq(commerceAccessTokens.userId, input.userId),
            isNull(commerceAccessTokens.revokedAt),
            gt(commerceAccessTokens.expiresAt, now),
          ),
        );
      if ((live?.count ?? 0) >= accessTokenLiveLimit)
        throw new Error("ACCESS_TOKEN_LIMIT");
      const secret = generateAccessTokenSecret();
      const [inserted] = await tx
        .insert(commerceAccessTokens)
        .values({
          id: randomUUID(),
          userId: input.userId,
          organizationId: input.organizationId,
          name: input.name.trim(),
          scope: input.scope,
          tokenPrefix: accessTokenDisplayPrefix(secret),
          tokenHash: hashAccessTokenSecret(secret),
          mfaFactorId: input.mfaFactorId,
          createdAt: now,
          expiresAt: new Date(now.getTime() + input.expiresInDays * 86_400_000),
        })
        .returning();
      if (!inserted) throw new Error("ACCESS_TOKEN_INSERT_FAILED");
      const created = record(inserted);
      await appendAuditAndOutbox(tx, {
        aggregateType: "access_token",
        aggregateId: created.id,
        aggregateVersion: inserted.version,
        eventType: "access_token.created",
        actor: input.actor,
        requestId: randomUUID(),
        after: {
          userId: created.userId,
          name: created.name,
          scope: created.scope,
          prefix: created.prefix,
          expiresAt: created.expiresAt,
        },
      });
      return { record: created, secret };
    });
  }

  /** A person's tokens, newest first: live ones, and ended ones for 30 days. */
  list(userId: string, now: Date = new Date()): Promise<AccessTokenRecord[]> {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(commerceAccessTokens)
        .where(
          and(eq(commerceAccessTokens.userId, userId), recentlyRelevant(now)),
        )
        .orderBy(
          desc(commerceAccessTokens.createdAt),
          desc(commerceAccessTokens.id),
        )
        .limit(100);
      return rows.map(record);
    });
  }

  /** Everyone's tokens in a staff organization, for the Team page. */
  listForOrganization(
    organizationId: string,
    now: Date = new Date(),
  ): Promise<AccessTokenAdminRecord[]> {
    return this.tx(async (tx) => {
      const rows = await tx
        .select({
          token: commerceAccessTokens,
          userName: commerceUsers.name,
          userEmail: commerceUsers.email,
        })
        .from(commerceAccessTokens)
        .innerJoin(
          commerceUsers,
          eq(commerceUsers.id, commerceAccessTokens.userId),
        )
        .where(
          and(
            eq(commerceAccessTokens.organizationId, organizationId),
            recentlyRelevant(now),
          ),
        )
        .orderBy(
          desc(commerceAccessTokens.createdAt),
          desc(commerceAccessTokens.id),
        )
        .limit(200);
      return rows.map(({ token, userName, userEmail }) => ({
        ...record(token),
        userName,
        userEmail,
      }));
    });
  }

  /**
   * Revokes a token. `ownerId` limits it to the person's own tokens and
   * `organizationId` to one staff organization's. Revoking a revoked token
   * changes nothing and records nothing.
   */
  revoke(input: {
    id: string;
    actor: UserActor;
    reason: "owner" | "admin";
    ownerId?: string;
    organizationId?: string;
  }): Promise<AccessTokenRecord> {
    return this.tx(async (tx) => {
      const [current] = await tx
        .select()
        .from(commerceAccessTokens)
        .where(eq(commerceAccessTokens.id, input.id))
        .for("update");
      if (
        !current ||
        (input.ownerId !== undefined && current.userId !== input.ownerId) ||
        (input.organizationId !== undefined &&
          current.organizationId !== input.organizationId)
      )
        throw new Error("ACCESS_TOKEN_NOT_FOUND");
      if (current.revokedAt) return record(current);
      const [updated] = await tx
        .update(commerceAccessTokens)
        .set({
          revokedAt: sql`now()`,
          revokedById: input.actor.id,
          revokedReason: input.reason,
          version: current.version + 1,
        })
        .where(eq(commerceAccessTokens.id, input.id))
        .returning();
      if (!updated) throw new Error("ACCESS_TOKEN_UPDATE_FAILED");
      await appendAuditAndOutbox(tx, {
        aggregateType: "access_token",
        aggregateId: updated.id,
        aggregateVersion: updated.version,
        eventType: "access_token.revoked",
        actor: input.actor,
        requestId: randomUUID(),
        after: { userId: updated.userId, revokedReason: input.reason },
      });
      return record(updated);
    });
  }

  /**
   * The live token a secret names, counted against its one-minute window and
   * marked used. Null when the secret is malformed, unknown, revoked or
   * expired; all four look the same to the caller.
   */
  async authenticate(secret: string): Promise<AuthenticatedAccessToken | null> {
    if (!isAccessTokenSecret(secret)) return null;
    const hash = hashAccessTokenSecret(secret);
    return this.tx(async (tx) => {
      const fresh = sql`${commerceAccessTokens.rateWindowStartedAt} is null or ${commerceAccessTokens.rateWindowStartedAt} <= now() - interval '1 minute'`;
      const [row] = await tx
        .update(commerceAccessTokens)
        .set({
          lastUsedAt: sql`now()`,
          rateWindowStartedAt: sql`case when ${fresh} then now() else ${commerceAccessTokens.rateWindowStartedAt} end`,
          rateWindowCount: sql`case when ${fresh} then 1 else ${commerceAccessTokens.rateWindowCount} + 1 end`,
        })
        .where(
          and(
            eq(commerceAccessTokens.tokenHash, hash),
            isNull(commerceAccessTokens.revokedAt),
            sql`${commerceAccessTokens.expiresAt} > now()`,
          ),
        )
        .returning({
          id: commerceAccessTokens.id,
          userId: commerceAccessTokens.userId,
          organizationId: commerceAccessTokens.organizationId,
          name: commerceAccessTokens.name,
          scope: commerceAccessTokens.scope,
          expiresAt: commerceAccessTokens.expiresAt,
          windowCount: commerceAccessTokens.rateWindowCount,
          windowResetSeconds: sql<number>`greatest(1, ceil(extract(epoch from (${commerceAccessTokens.rateWindowStartedAt} + interval '1 minute' - now()))))::int`,
        });
      if (!row) return null;
      return { ...row, expiresAt: row.expiresAt.toISOString() };
    });
  }

  /** Whether commerce records the person as enrolled in MFA. */
  async mfaEnrolled(userId: string): Promise<boolean> {
    return this.tx(async (tx) => {
      const [row] = await tx
        .select({ enrolled: commerceUsers.mfaEnrolled })
        .from(commerceUsers)
        .where(eq(commerceUsers.id, userId));
      return row?.enrolled ?? false;
    });
  }

  /**
   * The authenticator behind a session's MFA verification in the last 30
   * minutes, or null when the session has none that recent.
   */
  async sessionFactor(input: {
    sessionId: string;
    workosUserId: string;
    workosOrganizationId: string;
  }): Promise<string | null> {
    return this.tx(async (tx) => {
      const [row] = await tx.execute<{ factor_id: string }>(sql`
        select factor_id from public.experience_mfa_receipts
        where session_id = ${input.sessionId}
          and workos_user_id = ${input.workosUserId}
          and workos_organization_id = ${input.workosOrganizationId}
          and expires_at > now()
          and verified_at > now() - interval '30 minutes'
        order by verified_at desc limit 1`);
      return row?.factor_id ?? null;
    });
  }

  /** One audit event for one MCP tool call, against the token that made it. */
  recordToolCall(call: AccessTokenToolCall): Promise<void> {
    return withInternalTransaction(this.db, call.requestId, async (tx) => {
      const [row] = await tx
        .update(commerceAccessTokens)
        .set({ version: sql`${commerceAccessTokens.version} + 1` })
        .where(eq(commerceAccessTokens.id, call.tokenId))
        .returning({ version: commerceAccessTokens.version });
      if (!row) throw new Error("ACCESS_TOKEN_NOT_FOUND");
      await appendAuditAndOutbox(tx, {
        aggregateType: "access_token",
        aggregateId: call.tokenId,
        aggregateVersion: row.version,
        eventType: "mcp.tool_called",
        actor: call.actor,
        requestId: call.requestId,
        metadata: {
          channel: "mcp",
          tokenId: call.tokenId,
          tool: call.tool,
          outcome: call.outcome,
          ...(call.code ? { code: call.code } : {}),
          ...(call.httpStatus ? { httpStatus: call.httpStatus } : {}),
          ...(call.targets && Object.keys(call.targets).length
            ? { targets: call.targets }
            : {}),
        },
      });
    });
  }
}

/** Live tokens, and tokens that ended in the last 30 days. */
function recentlyRelevant(now: Date) {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000);
  return or(
    and(
      isNull(commerceAccessTokens.revokedAt),
      gt(commerceAccessTokens.expiresAt, cutoff),
    ),
    gt(commerceAccessTokens.revokedAt, cutoff),
  );
}
