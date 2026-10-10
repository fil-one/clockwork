import "server-only";

import { InviteRepository } from "@clockwork/db";

import { getOptionalServiceDatabase } from "@/src/db/service";

/**
 * Invites to customer and partner organizations. Links are derived with the
 * deployment's authorization secret, so a deployment without it, or without
 * a database, cannot read or accept one.
 */
export function inviteRepository(): InviteRepository {
  const database = getOptionalServiceDatabase();
  const secret = process.env.AUTHORIZATION_CONTEXT_SECRET?.trim();
  if (!database || !secret || secret.length < 32)
    throw new Error("INVITE_UNAVAILABLE");
  return new InviteRepository(database, secret);
}

/** A token is the base64url of a SHA-256 HMAC: 43 characters. */
export const inviteTokenShape = /^[A-Za-z0-9_-]{43}$/u;
