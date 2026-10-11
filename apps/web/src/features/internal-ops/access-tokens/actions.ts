"use server";

import { revalidatePath } from "next/cache";

import {
  AccessTokenCreateSchema,
  AccessTokenRevokeSchema,
  type AccessTokenRecord,
} from "@clockwork/contracts";

import { accessTokenRepository } from "@/src/auth/access-token-session";
import {
  explicitDemoIdentityEnabled,
  getCommerceSession,
  SessionExpiredError,
  type CommerceSession,
} from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";
import { staffMayUse } from "@/src/features/shell/staff-access";

import type { AccessTokenActionResult } from "./model";
import { mayHoldAccessTokens, tokenCreationFactor } from "./server";

type Failure = Extract<AccessTokenActionResult, { ok: false }>;
const fail = (code: Failure["code"]): Failure => ({ ok: false, code });

async function staffSession(): Promise<CommerceSession | Failure> {
  if (explicitDemoIdentityEnabled() || !getOptionalServiceDatabase())
    return fail("NOT_AVAILABLE");
  try {
    return await getCommerceSession();
  } catch (error) {
    if (error instanceof SessionExpiredError) return fail("SESSION_EXPIRED");
    return fail("NOT_PERMITTED");
  }
}

const actor = (session: CommerceSession) => ({
  kind: "user" as const,
  id: session.userId,
  display: session.profile.name,
});

/**
 * Creates a personal access token for the MCP endpoint. Only the staff member
 * themselves, in their own session, after an MFA verification in that session
 * in the last 30 minutes; the secret comes back once and only its hash is
 * kept.
 */
export async function createAccessToken(
  raw: unknown,
): Promise<
  AccessTokenActionResult<{ record: AccessTokenRecord; secret: string }>
> {
  const session = await staffSession();
  if ("ok" in session) return session;
  if (!mayHoldAccessTokens(session) || !session.organizationId)
    return fail("DIRECT_SESSION_REQUIRED");
  const parsed = AccessTokenCreateSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID_INPUT");
  const repository = accessTokenRepository();
  try {
    const verified = await tokenCreationFactor(session);
    if (!verified) return fail("RECENT_SIGN_IN_REQUIRED");
    const created = await repository.create({
      userId: session.userId,
      organizationId: session.organizationId,
      ...parsed.data,
      mfaFactorId: verified.factorId,
      actor: actor(session),
    });
    revalidatePath("/settings");
    return { ok: true, value: created };
  } catch (error) {
    if (error instanceof Error && error.message === "ACCESS_TOKEN_LIMIT")
      return fail("LIMIT_REACHED");
    console.error("Access token could not be created", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return fail("UNEXPECTED");
  }
}

/** Revokes one of the signed-in staff member's own tokens. */
export async function revokeOwnAccessToken(
  raw: unknown,
): Promise<AccessTokenActionResult> {
  const session = await staffSession();
  if ("ok" in session) return session;
  if (
    !session.isInternalStaff ||
    session.authenticationSource === "access-token"
  )
    return fail("DIRECT_SESSION_REQUIRED");
  const parsed = AccessTokenRevokeSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID_INPUT");
  try {
    await accessTokenRepository().revoke({
      id: parsed.data.id,
      actor: actor(session),
      reason: "owner",
      ownerId: session.userId,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ACCESS_TOKEN_NOT_FOUND")
      return fail("NOT_FOUND");
    return fail("UNEXPECTED");
  }
  revalidatePath("/settings");
  return { ok: true, value: null };
}

/** A commerce administrator revokes anyone's token from the Team page. */
export async function revokeStaffAccessToken(
  raw: unknown,
): Promise<AccessTokenActionResult> {
  const session = await staffSession();
  if ("ok" in session) return session;
  if (
    !session.isInternalStaff ||
    !session.organizationId ||
    !staffMayUse(session, "staff:manage")
  )
    return fail("NOT_PERMITTED");
  if (
    session.authenticationSource === "access-token" ||
    session.impersonation ||
    session.assistedSession
  )
    return fail("DIRECT_SESSION_REQUIRED");
  const parsed = AccessTokenRevokeSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID_INPUT");
  try {
    await accessTokenRepository().revoke({
      id: parsed.data.id,
      actor: actor(session),
      reason: "admin",
      organizationId: session.organizationId,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ACCESS_TOKEN_NOT_FOUND")
      return fail("NOT_FOUND");
    return fail("UNEXPECTED");
  }
  revalidatePath("/internal/team");
  return { ok: true, value: null };
}
