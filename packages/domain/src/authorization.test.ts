import { hasPermission, ids, permissions, roles } from "@clockwork/contracts";
import type { Permission, Role } from "@clockwork/contracts";
import { describe, expect, it } from "vitest";

import type { AuthorizationContext } from "./authorization";
import {
  authorizationActor,
  AuthorizationError,
  authorize,
  internalOnlyPermissions,
  requireAssistedActionReason,
  unscopedBecause,
  unscopedInternalOnly,
  unscopedInternalStaff,
  unscopedJustifications,
} from "./authorization";

const identity = {
  effectiveUserId: ids.user.parse("20000000-0000-4000-8000-000000000002"),
  actualUserId: ids.user.parse("20000000-0000-4000-8000-000000000001"),
  customerAccountId: ids.account.parse("10000000-0000-4000-8000-000000000004"),
} as const;

function internalContext(
  overrides: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  return {
    userId: identity.effectiveUserId,
    accountIds: [],
    roles: ["internal_operator"],
    isInternalStaff: true,
    mfaVerified: true,
    recentAuthenticationVerified: true,
    ...overrides,
  };
}

function tenantContext(
  overrides: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  return {
    userId: identity.effectiveUserId,
    accountIds: [identity.customerAccountId],
    roles: ["owner"],
    isInternalStaff: false,
    mfaVerified: true,
    recentAuthenticationVerified: true,
    ...overrides,
  };
}

describe("commerce authorization boundaries", () => {
  it("does not grant internal or segregated approvals to customer owners", () => {
    const owner = tenantContext();

    expect(() =>
      authorize(owner, "destructive:approve", unscopedInternalOnly),
    ).toThrow(new AuthorizationError("ACCOUNT_SCOPE"));
    expect(() =>
      authorize(owner, "impersonation:assume", unscopedInternalOnly),
    ).toThrow(new AuthorizationError("ACCOUNT_SCOPE"));
  });

  it("requires MFA for a privileged role", () => {
    const context = internalContext({ mfaVerified: false });

    expect(() =>
      authorize(context, "system:operate", unscopedInternalOnly),
    ).toThrow(new AuthorizationError("MFA_REQUIRED"));
  });

  it("rejects a role and internal-staff classification mismatch", () => {
    const context = internalContext({ isInternalStaff: false });

    expect(() =>
      authorize(context, "account:read", identity.customerAccountId),
    ).toThrow(new AuthorizationError("STAFF_BOUNDARY"));
  });

  it("does not let staff enter customer account scope without authorization", () => {
    expect(() =>
      authorize(internalContext(), "account:read", identity.customerAccountId),
    ).toThrow(new AuthorizationError("ACCOUNT_SCOPE"));
  });

  it("does not compile a decision that names no account scope", () => {
    // The compiler is the assertion, so the body is never run. `pnpm turbo run
    // typecheck` is what executes this test; without the third argument the
    // build fails with TS2554 rather than a route silently authorizing across
    // every tenant.
    function omittedScope() {
      // @ts-expect-error every decision must state its account scope
      authorize(internalContext(), "account:read");
      // @ts-expect-error every decision must state its account scope
      authorize(internalContext(), "order:read");
      // Even a permission no tenant role can hold has to say so out loud.
      // @ts-expect-error every decision must state its account scope
      authorize(internalContext(), "system:operate");
      // A permission a tenant role holds cannot claim to be internal-only.
      // @ts-expect-error account:read is reachable by tenant roles
      authorize(internalContext(), "account:read", unscopedInternalOnly);
      // Nor can an unknown justification stand in for one.
      // @ts-expect-error the justification is not on the reviewed list
      authorize(internalContext(), "order:read", unscopedBecause("whatever"));
    }

    expect(omittedScope).toBeInstanceOf(Function);
  });

  it("denies a scope it cannot classify instead of skipping the tenant check", () => {
    // Untyped callers -- compiled JavaScript, a test double, an `any` that
    // slipped through -- reach the same control. Every one of these used to
    // mean "no account check"; each of them is now a denial.
    for (const scope of [
      undefined,
      null,
      "",
      "   ",
      {},
      { "clockwork.authorization.unscoped": "internal-staff" },
      { "clockwork.authorization.unscoped": "justified" },
      {
        "clockwork.authorization.unscoped": "justified",
        justification: "because-i-said-so",
      },
      42,
    ]) {
      expect(() =>
        (
          authorize as (
            context: AuthorizationContext,
            permission: Permission,
            scope: unknown,
          ) => void
        )(internalContext(), "order:read", scope),
      ).toThrow(new AuthorizationError("ACCOUNT_SCOPE_REQUIRED"));
    }
  });

  it("keeps an internal-only decision inside internal staff", () => {
    expect(() =>
      authorize(internalContext(), "system:operate", unscopedInternalOnly),
    ).not.toThrow();
    expect(() =>
      authorize(
        internalContext({ roles: ["destructive_action_approver"] }),
        "destructive:approve",
        unscopedInternalOnly,
      ),
    ).not.toThrow();
  });

  it("refuses the internal-only sentinel for a permission a tenant role holds", () => {
    // The type already refuses this; the runtime refuses it again so that a
    // future grant of the permission to a tenant role cannot leave a compiled
    // call site quietly unscoped.
    expect(() =>
      (
        authorize as (
          context: AuthorizationContext,
          permission: Permission,
          scope: unknown,
        ) => void
      )(internalContext(), "order:read", unscopedInternalOnly),
    ).toThrow(new AuthorizationError("ACCOUNT_SCOPE_REQUIRED"));
  });

  it("derives the internal-only permission set from the live role table", () => {
    const tenantRoles = roles.filter(
      (role) =>
        ![
          "internal_operator",
          "finance_approver",
          "legal_approver",
          "destructive_action_approver",
        ].includes(role),
    ) as readonly Role[];
    for (const permission of permissions) {
      const heldByTenant = tenantRoles.some((role) =>
        hasPermission(role, permission),
      );
      expect(internalOnlyPermissions.has(permission)).toBe(!heldByTenant);
    }
    // A sanity anchor so the loop above cannot pass vacuously.
    expect(internalOnlyPermissions.has("system:operate")).toBe(true);
    expect(internalOnlyPermissions.has("account:read")).toBe(false);
    expect(internalOnlyPermissions.has("destructive:request")).toBe(false);
  });

  it("keeps the type and the runtime set of internal-only permissions in step", () => {
    // Compile-time half: every permission the runtime set contains today must
    // also be one the type admits the sentinel for. Granting any of these to a
    // tenant role breaks this build rather than quietly leaving a compiled
    // call site unscoped.
    function typeAdmitsTheSameSet() {
      const context = internalContext();
      authorize(context, "agreement:approve", unscopedInternalOnly);
      authorize(context, "quote:approve", unscopedInternalOnly);
      authorize(context, "billing:approve", unscopedInternalOnly);
      authorize(context, "system:operate", unscopedInternalOnly);
      authorize(context, "impersonation:assume", unscopedInternalOnly);
      authorize(context, "destructive:approve", unscopedInternalOnly);
      authorize(context, "migration:execute", unscopedInternalOnly);
    }

    // Runtime half: the list above is exactly the derived set, so a permission
    // added to the contract without a tenant grant has to be added here too.
    expect([...internalOnlyPermissions].sort()).toEqual(
      [
        "agreement:approve",
        "billing:approve",
        "destructive:approve",
        "impersonation:assume",
        "migration:execute",
        "quote:approve",
        "system:operate",
      ].sort(),
    );
    expect(typeAdmitsTheSameSet).toBeInstanceOf(Function);
  });

  it("restricts a cross-account read to internal staff inside the control", () => {
    expect(() =>
      authorize(internalContext(), "order:read", unscopedInternalStaff),
    ).not.toThrow();
    expect(() =>
      authorize(tenantContext(), "order:read", unscopedInternalStaff),
    ).toThrow(new AuthorizationError("ACCOUNT_SCOPE_REQUIRED"));
  });

  it("keeps the list of unscoped justifications closed and reviewed", () => {
    // Adding a call site that skips the tenant check means adding a member
    // here, in the authorization module, and updating this list.
    expect([...unscopedJustifications]).toEqual([
      "global-agreement-template-catalog",
      "partner-order-acceptance-derives-account-from-issued-quote",
      "renewal-command-center-restricted-to-session-accounts",
    ]);
    expect(() =>
      authorize(
        tenantContext(),
        "agreement:read",
        unscopedBecause("global-agreement-template-catalog"),
      ),
    ).not.toThrow();
  });

  it("authorizes an assisted action and preserves actual and effective actors", () => {
    const context = internalContext({
      impersonation: {
        accountId: identity.customerAccountId,
        reason: "Customer requested assisted checkout",
        sessionId: "assisted-session-001",
        actualUserId: identity.actualUserId,
        actualActorEmail: "operator@filone.com",
      },
    });

    expect(() =>
      authorize(context, "account:write", identity.customerAccountId),
    ).not.toThrow();
    expect(() => requireAssistedActionReason(context)).not.toThrow();
    expect(authorizationActor(context)).toEqual({
      kind: "user",
      id: identity.actualUserId,
      display: "operator@filone.com",
      effectiveUserId: identity.effectiveUserId,
      impersonatedAccountId: identity.customerAccountId,
      assistedActionReason: "Customer requested assisted checkout",
    });
  });
});
