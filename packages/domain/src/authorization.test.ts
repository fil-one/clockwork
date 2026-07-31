import { ids } from "@clockwork/contracts";
import { describe, expect, it } from "vitest";

import type { AuthorizationContext } from "./authorization";
import {
  authorizationActor,
  AuthorizationError,
  authorize,
  requireAssistedActionReason,
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

describe("commerce authorization boundaries", () => {
  it("does not grant internal or segregated approvals to customer owners", () => {
    const owner: AuthorizationContext = {
      userId: identity.effectiveUserId,
      accountIds: [identity.customerAccountId],
      roles: ["owner"],
      isInternalStaff: false,
      mfaVerified: true,
      recentAuthenticationVerified: true,
    };

    expect(() => authorize(owner, "destructive:approve")).toThrow(
      new AuthorizationError("FORBIDDEN"),
    );
    expect(() => authorize(owner, "impersonation:assume")).toThrow(
      new AuthorizationError("FORBIDDEN"),
    );
  });

  it("requires MFA for a privileged role", () => {
    const context = internalContext({ mfaVerified: false });

    expect(() => authorize(context, "system:operate")).toThrow(
      new AuthorizationError("MFA_REQUIRED"),
    );
  });

  it("rejects a role and internal-staff classification mismatch", () => {
    const context = internalContext({ isInternalStaff: false });

    expect(() => authorize(context, "account:read")).toThrow(
      new AuthorizationError("STAFF_BOUNDARY"),
    );
  });

  it("does not let staff enter customer account scope without authorization", () => {
    expect(() =>
      authorize(internalContext(), "account:read", identity.customerAccountId),
    ).toThrow(new AuthorizationError("ACCOUNT_SCOPE"));
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
