import type { SessionClaims } from "@clockwork/api";
import { permissionsForRoles, type Role } from "@clockwork/contracts";
import { describe, expect, it } from "vitest";

import {
  authorizationContext,
  requireAudience,
  resolveScopedAccount,
} from "./authorization";

const accountA = "10000000-0000-4000-8000-000000000001";
const accountB = "10000000-0000-4000-8000-000000000002";
const staffUser = "20000000-0000-4000-8000-000000000001";

function assisted(overrides: Partial<SessionClaims> = {}): SessionClaims {
  return {
    userId: staffUser,
    accountIds: [],
    roles: ["internal_operator"],
    permissions: permissionsForRoles(["internal_operator"], { assisted: true }),
    isInternalStaff: true,
    mfaVerified: true,
    recentAuthenticationVerified: true,
    impersonation: {
      accountId: accountA,
      reason: "Customer requested guided order recovery",
      sessionId: "60000000-0000-4000-8000-000000000001",
      actualUserId: staffUser,
      actualActorEmail: "operator@filone.com",
    },
    ...overrides,
  };
}

describe("experience assisted authorization", () => {
  it("uses the persisted effective account but preserves actual actor and roles", () => {
    const session = assisted();
    expect(resolveScopedAccount(session, "customer", null)).toBe(accountA);
    expect(resolveScopedAccount(session, "customer", accountA)).toBe(accountA);
    expect(authorizationContext(session, "request-12345678")).toEqual({
      userId: staffUser,
      accountIds: [accountA],
      roles: ["internal_operator"],
      permissions: permissionsForRoles(["internal_operator"], {
        assisted: true,
      }),
      isInternalStaff: true,
      requestId: "request-12345678",
    });
  });

  it("rejects a forged target account", () => {
    expect(() =>
      resolveScopedAccount(assisted(), "customer", accountB),
    ).toThrow("Account access denied");
  });

  it("rejects a missing reason and mismatched immutable actor", () => {
    const impersonation = assisted().impersonation;
    if (!impersonation) throw new Error("Expected assisted-session fixture");
    const noReason = assisted({
      impersonation: { ...impersonation, reason: "" },
    });
    const mismatchedActor = assisted({
      impersonation: {
        ...impersonation,
        actualUserId: "20000000-0000-4000-8000-000000000099",
      },
    });
    expect(() => requireAudience(noReason, "customer")).toThrow(
      "active, reason-bound assisted session",
    );
    expect(() => requireAudience(mismatchedActor, "partner")).toThrow(
      "active, reason-bound assisted session",
    );
  });

  it("signs an assisted session's withheld approvals into the database context", () => {
    const session = assisted({
      roles: ["commerce_admin"],
      permissions: permissionsForRoles(["commerce_admin"], { assisted: true }),
    });
    const context = authorizationContext(session, "request-12345678");
    expect(context.permissions).not.toContain("quote:approve");
    expect(context.permissions).toContain("operations:write");
  });

  it("never lets unassisted staff enter a tenant audience", () => {
    const { impersonation, ...session } = assisted();
    expect(impersonation).toBeDefined();
    expect(() => requireAudience(session, "customer")).toThrow(
      "audited assisted session",
    );
  });
});

describe("tenant portal audiences", () => {
  function tenant(
    role: Role,
    side?: "customer" | "channel_partner" | "referral_partner",
  ): SessionClaims {
    return {
      userId: "20000000-0000-4000-8000-000000000002",
      accountIds: [accountA],
      roles: [role],
      permissions: permissionsForRoles([role], side ? { side } : {}),
      isInternalStaff: false,
      mfaVerified: true,
      recentAuthenticationVerified: true,
    };
  }

  it.each([
    ["owner", undefined, "customer"],
    ["member", undefined, "customer"],
    ["partner_admin", "channel_partner", "partner"],
    ["partner_seller", "referral_partner", "partner"],
  ] as const)("admits %s only to its own portal", (role, side, audience) => {
    const session = tenant(role, side);
    const other = audience === "customer" ? "partner" : "customer";
    expect(() => requireAudience(session, audience)).not.toThrow();
    expect(() => requireAudience(session, other)).toThrow(
      "Portal audience access denied",
    );
  });

  it("refuses a tenant session that holds no permissions", () => {
    expect(() =>
      requireAudience({ ...tenant("owner"), permissions: [] }, "customer"),
    ).toThrow("Portal audience access denied");
  });
});
