import {
  hasPermission,
  internalRoles,
  permissions,
  privilegedRoles,
  roles,
} from "@clockwork/contracts";
import type {
  AccountId,
  Actor,
  Permission,
  Role,
  rolePermissions,
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
      | "FORBIDDEN"
      | "MFA_REQUIRED"
      | "STAFF_BOUNDARY"
      | "ACCOUNT_SCOPE"
      | "ACCOUNT_SCOPE_REQUIRED",
  ) {
    super(code);
  }
}

type TenantRole = Exclude<Role, (typeof internalRoles)[number]>;

/**
 * The permissions no tenant role can hold, derived from the role table rather
 * than listed, so granting one of them to a tenant role cannot silently leave
 * an unscoped decision legal.
 */
export type InternalOnlyPermission = Exclude<
  Permission,
  (typeof rolePermissions)[TenantRole][number]
>;

const tenantRoles: readonly Role[] = roles.filter(
  (role) => !internalRoles.includes(role as (typeof internalRoles)[number]),
);

/**
 * The runtime twin of {@link InternalOnlyPermission}. Derived from the same
 * role table, so a permission granted to a tenant role stops qualifying here
 * the moment the grant lands -- the sentinel cannot outlive the claim its
 * documentation makes about it.
 */
export const internalOnlyPermissions: ReadonlySet<Permission> = new Set(
  permissions.filter(
    (permission) =>
      !tenantRoles.some((role) => hasPermission(role, permission)),
  ),
);

const unscopedMarker = "clockwork.authorization.unscoped" as const;

interface UnscopedInternalOnlyScope {
  readonly [unscopedMarker]: "internal-only-permission";
}

interface UnscopedInternalStaffScope {
  readonly [unscopedMarker]: "internal-staff-only";
}

interface UnscopedJustifiedScope {
  readonly [unscopedMarker]: "justified";
  readonly justification: UnscopedJustification;
}

/**
 * Declare that a decision names no account because the permission itself is one
 * no tenant role can hold. The type only admits this value for such a
 * permission, and {@link authorize} re-checks that against the live role table
 * and additionally requires the caller to be internal staff.
 */
export const unscopedInternalOnly: UnscopedInternalOnlyScope = {
  [unscopedMarker]: "internal-only-permission",
};

/**
 * Declare that a decision reads across accounts and is therefore restricted to
 * internal staff. Legal with any permission, because the control -- not the
 * route -- is what enforces the staff boundary: a tenant reaching here is
 * denied with `ACCOUNT_SCOPE_REQUIRED`.
 */
export const unscopedInternalStaff: UnscopedInternalStaffScope = {
  [unscopedMarker]: "internal-staff-only",
};

/**
 * The complete set of places where a tenant-reachable decision deliberately
 * names no account. Each entry records where the account boundary actually is,
 * because it is not here. Adding a call site that skips the tenant check means
 * adding a member to this union, in this file -- there is no way to opt out of
 * scoping from a route alone.
 */
export const unscopedJustifications = [
  /**
   * `GET /v1/lifecycle/agreement-templates/active` and the
   * `agreement_template` artifact download read the published legal catalogue.
   * `agreement_templates` carries no account column; the rows are approved,
   * effective, jurisdiction-keyed template text that every tenant executes
   * against. There is no account to name.
   */
  "global-agreement-template-catalog",
  /**
   * Order acceptance by a partner derives the counterparty from the persisted
   * issued quote rather than from the request body. Scoping the decision to the
   * caller-supplied account would reintroduce caller-asserted counterparty
   * truth at the API boundary; the service resolves it from stored state.
   */
  "partner-order-acceptance-derives-account-from-issued-quote",
  /**
   * `GET /v1/lifecycle/renewals` with no account filter is scoped downstream by
   * `LifecycleCommandRepository.renewalCommandCenter`, which reads
   * `authorization.accountIds` and returns nothing when that list is empty.
   * The tenant boundary is the session's own account list.
   */
  "renewal-command-center-restricted-to-session-accounts",
] as const;

export type UnscopedJustification = (typeof unscopedJustifications)[number];

/** Name, at the call site, the reason a decision carries no account scope. */
export function unscopedBecause(
  justification: UnscopedJustification,
): UnscopedJustifiedScope {
  return { [unscopedMarker]: "justified", justification };
}

/**
 * The account a decision is made inside. There is no `undefined` member and the
 * argument is not optional: omitting it is a compile error, and every other
 * member says out loud what stands in for the tenant check.
 */
export type AccountScope<P extends Permission = Permission> =
  | AccountId
  | UnscopedInternalStaffScope
  | UnscopedJustifiedScope
  | ([P] extends [InternalOnlyPermission] ? UnscopedInternalOnlyScope : never);

type ScopeDecision =
  | { readonly kind: "account"; readonly accountId: AccountId }
  | { readonly kind: "internal-only" }
  | { readonly kind: "internal-staff" }
  | { readonly kind: "justified" };

/**
 * Classify the scope argument or deny. Anything this cannot place -- including
 * `undefined` from an untyped caller, an empty account id, or a justification
 * that is not on the list above -- is a denial, never a skipped check.
 */
function classifyScope(permission: Permission, scope: unknown): ScopeDecision {
  if (typeof scope === "string") {
    if (scope.trim().length === 0)
      throw new AuthorizationError("ACCOUNT_SCOPE_REQUIRED");
    return { kind: "account", accountId: scope as AccountId };
  }
  if (typeof scope !== "object" || scope === null)
    throw new AuthorizationError("ACCOUNT_SCOPE_REQUIRED");
  const marker = (scope as Record<string, unknown>)[unscopedMarker];
  if (marker === "internal-only-permission") {
    if (!internalOnlyPermissions.has(permission))
      throw new AuthorizationError("ACCOUNT_SCOPE_REQUIRED");
    return { kind: "internal-only" };
  }
  if (marker === "internal-staff-only") return { kind: "internal-staff" };
  if (marker === "justified") {
    const justification = (scope as Record<string, unknown>)["justification"];
    if (
      typeof justification !== "string" ||
      !(unscopedJustifications as readonly string[]).includes(justification)
    )
      throw new AuthorizationError("ACCOUNT_SCOPE_REQUIRED");
    return { kind: "justified" };
  }
  throw new AuthorizationError("ACCOUNT_SCOPE_REQUIRED");
}

export function authorize<P extends Permission>(
  context: AuthorizationContext,
  permission: P,
  scope: AccountScope<P>,
): void;
export function authorize(
  context: AuthorizationContext,
  permission: Permission,
  scope: unknown,
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
  const decision = classifyScope(permission, scope);
  if (decision.kind === "internal-only" && !context.isInternalStaff) {
    throw new AuthorizationError("ACCOUNT_SCOPE");
  }
  if (decision.kind === "internal-staff" && !context.isInternalStaff) {
    throw new AuthorizationError("ACCOUNT_SCOPE_REQUIRED");
  }
  if (
    decision.kind === "account" &&
    !context.accountIds.includes(decision.accountId)
  ) {
    if (
      !context.isInternalStaff ||
      !context.impersonation ||
      context.impersonation.accountId !== decision.accountId ||
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
