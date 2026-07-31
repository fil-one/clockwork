import {
  hasPermission,
  internalRoles,
  privilegedRoles,
} from "@clockwork/contracts";
import type {
  AccountId,
  Actor,
  Permission,
  Role,
  UserId,
} from "@clockwork/contracts";

export interface AuthorizationContext {
  userId: UserId;
  organizationId?: string;
  accountIds: readonly AccountId[];
  roles: readonly Role[];
  isInternalStaff: boolean;
  mfaVerified: boolean;
  recentAuthenticationVerified: boolean;
  impersonation?: {
    accountId: AccountId;
    reason: string;
    sessionId: string;
    actualUserId: UserId;
    actualActorEmail: string;
  };
}

export class AuthorizationError extends Error {
  public constructor(
    public readonly code:
      "FORBIDDEN" | "MFA_REQUIRED" | "STAFF_BOUNDARY" | "ACCOUNT_SCOPE",
  ) {
    super(code);
  }
}

export function authorize(
  context: AuthorizationContext,
  permission: Permission,
  accountId?: AccountId,
): void {
  if (
    context.roles.some((role) =>
      privilegedRoles.includes(role as (typeof privilegedRoles)[number]),
    ) &&
    !context.mfaVerified
  ) {
    throw new AuthorizationError("MFA_REQUIRED");
  }
  if (
    context.roles.some((role) =>
      internalRoles.includes(role as (typeof internalRoles)[number]),
    ) !== context.isInternalStaff
  ) {
    throw new AuthorizationError("STAFF_BOUNDARY");
  }
  if (accountId && !context.accountIds.includes(accountId)) {
    if (
      !context.isInternalStaff ||
      !context.impersonation ||
      context.impersonation.accountId !== accountId ||
      context.impersonation.reason.trim().length < 8
    )
      throw new AuthorizationError("ACCOUNT_SCOPE");
  }
  if (!context.roles.some((role) => hasPermission(role, permission))) {
    throw new AuthorizationError("FORBIDDEN");
  }
}

export function requireAssistedActionReason(
  context: AuthorizationContext,
): void {
  if (
    !context.impersonation ||
    context.impersonation.reason.trim().length < 8
  ) {
    throw new AuthorizationError("FORBIDDEN");
  }
}

/** Preserve actual and effective identities on every assisted audit event. */
export function authorizationActor(context: AuthorizationContext): Actor {
  if (context.impersonation)
    return {
      kind: "user",
      id: context.impersonation.actualUserId,
      display: context.impersonation.actualActorEmail,
      effectiveUserId: context.userId,
      impersonatedAccountId: context.impersonation.accountId,
      assistedActionReason: context.impersonation.reason,
    };
  return { kind: "user", id: context.userId };
}
