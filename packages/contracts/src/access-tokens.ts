import { z } from "zod";

/**
 * Staff personal access tokens for the MCP endpoint (001480). A token carries
 * a scope and an expiry, never roles: each request acts with the person's
 * current permissions.
 */
export const accessTokenScopes = ["read", "read_write"] as const;
export type AccessTokenScope = (typeof accessTokenScopes)[number];

/** Every secret starts with this, so a leaked one is recognisable. */
export const accessTokenSecretPrefix = "fo_pat_";
export const accessTokenDefaultDays = 90;
export const accessTokenMaxDays = 365;
/** Live tokens one person may hold at once. */
export const accessTokenLiveLimit = 20;
/** Requests one token may make in a minute. */
export const accessTokenRequestsPerMinute = 120;

export const accessTokenRevokedReasons = [
  "owner",
  "admin",
  "membership_removed",
  "mfa_reset",
] as const;
export type AccessTokenRevokedReason =
  (typeof accessTokenRevokedReasons)[number];

export const AccessTokenCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    scope: z.enum(accessTokenScopes),
    expiresInDays: z.coerce
      .number()
      .int()
      .min(1)
      .max(accessTokenMaxDays)
      .default(accessTokenDefaultDays),
  })
  .strict();

export const AccessTokenRevokeSchema = z.object({ id: z.uuid() }).strict();

export interface AccessTokenRecord {
  id: string;
  userId: string;
  name: string;
  scope: AccessTokenScope;
  /** `fo_pat_` and four characters of the secret. */
  prefix: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedReason: AccessTokenRevokedReason | null;
}

/** A token as a commerce administrator sees it on the Team page. */
export interface AccessTokenAdminRecord extends AccessTokenRecord {
  userName: string;
  userEmail: string;
}

/** Whether a token can still be used at `now`. */
export function accessTokenLive(
  token: Pick<AccessTokenRecord, "revokedAt" | "expiresAt">,
  now: Date = new Date(),
): boolean {
  return token.revokedAt === null && new Date(token.expiresAt) > now;
}
