import type { SessionClaims } from "@clockwork/api";
import { uuidV7 } from "@clockwork/contracts";

import { ExperienceProblem, type ExperienceAudience } from "./model";

const internalRole = (role: string) =>
  role.startsWith("internal_") ||
  role.endsWith("_approver") ||
  role === "destructive_action_approver";

export function requireAuthenticatedSession(
  session: SessionClaims | null,
): SessionClaims {
  if (!session)
    throw new ExperienceProblem(
      401,
      "AUTHENTICATION_REQUIRED",
      "Authentication is required",
    );
  return session;
}

export function requireAudience(
  session: SessionClaims,
  audience: ExperienceAudience,
): void {
  const hasInternalRole = session.roles.some(internalRole);
  if (audience === "internal") {
    if (!session.isInternalStaff || !hasInternalRole)
      throw new ExperienceProblem(
        403,
        "AUDIENCE_FORBIDDEN",
        "Internal audience access denied",
      );
    return;
  }
  if (session.isInternalStaff && !session.impersonation)
    throw new ExperienceProblem(
      403,
      "ASSISTED_SESSION_REQUIRED",
      "Internal staff must enter an audited assisted session for tenant portal access",
    );
  if (session.isInternalStaff) {
    if (
      !session.impersonation ||
      session.impersonation.reason.trim().length < 8 ||
      session.impersonation.actualUserId !== session.userId
    )
      throw new ExperienceProblem(
        403,
        "ASSISTED_SESSION_INVALID",
        "An active, reason-bound assisted session is required",
      );
    return;
  }
  const allowedRoles =
    audience === "partner"
      ? new Set(["partner_admin", "partner_seller"])
      : new Set(["owner", "admin", "billing", "member"]);
  if (!session.roles.some((role) => allowedRoles.has(role)))
    throw new ExperienceProblem(
      403,
      "AUDIENCE_FORBIDDEN",
      "Portal audience access denied",
    );
}

export function resolveScopedAccount(
  session: SessionClaims,
  audience: ExperienceAudience,
  requested: string | null,
): string | null {
  requireAudience(session, audience);
  if (audience === "internal") {
    if (requested)
      throw new ExperienceProblem(
        403,
        "INTERNAL_ACCOUNT_FILTER_FORBIDDEN",
        "Internal queues are scoped by their persisted projection, not a forged account parameter",
      );
    return null;
  }
  const assistedAccountId = session.impersonation?.accountId;
  const accountId = requested ?? assistedAccountId ?? session.accountIds[0];
  const allowed = assistedAccountId
    ? accountId === assistedAccountId
    : Boolean(accountId && session.accountIds.includes(accountId));
  if (!accountId || !allowed)
    throw new ExperienceProblem(
      403,
      "ACCOUNT_SCOPE_FORBIDDEN",
      "Account access denied",
    );
  return accountId;
}

export function requestId(request: Request): string {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && supplied.length >= 8 && supplied.length <= 128
    ? supplied
    : uuidV7();
}

export function idempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key")?.trim();
  if (!value || value.length < 16 || value.length > 255)
    throw new ExperienceProblem(
      422,
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid idempotency-key header is required",
    );
  return value;
}

export function authorizationContext(session: SessionClaims, id: string) {
  const effectiveAccountIds = session.impersonation
    ? [session.impersonation.accountId]
    : session.accountIds;
  return {
    userId: session.userId as never,
    accountIds: effectiveAccountIds,
    roles: session.roles,
    isInternalStaff: session.isInternalStaff,
    requestId: id,
  };
}
