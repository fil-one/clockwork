import { permissionsForRoles } from "@clockwork/contracts";
import type { Permission, Role } from "@clockwork/contracts";

export const workosSessions = {
  directOwner: {
    userId: "20000000-0000-4000-8000-000000000002",
    organizationId: "30000000-0000-4000-8000-000000000001",
    accountIds: ["10000000-0000-4000-8000-000000000001"],
    roles: ["owner"],
    permissions: permissionsForRoles(["owner"], { side: "customer" }),
    isInternalStaff: false,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  },
  partnerAdmin: {
    userId: "20000000-0000-4000-8000-000000000003",
    organizationId: "30000000-0000-4000-8000-000000000002",
    accountIds: [
      "10000000-0000-4000-8000-000000000002",
      "10000000-0000-4000-8000-000000000004",
    ],
    roles: ["partner_admin"],
    // Redwood is a referral partner (supabase/seed.sql).
    permissions: permissionsForRoles(["partner_admin"], {
      side: "referral_partner",
    }),
    isInternalStaff: false,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  },
  internalOperator: {
    userId: "20000000-0000-4000-8000-000000000001",
    organizationId: "30000000-0000-4000-8000-000000000008",
    accountIds: [],
    roles: ["internal_operator"],
    permissions: permissionsForRoles(["internal_operator"], {
      side: "fil_one",
    }),
    isInternalStaff: true,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  },
  privilegedWithoutMfa: {
    userId: "20000000-0000-4000-8000-000000000002",
    organizationId: "30000000-0000-4000-8000-000000000001",
    accountIds: ["10000000-0000-4000-8000-000000000001"],
    roles: ["admin"],
    permissions: permissionsForRoles(["admin"], { side: "customer" }),
    isInternalStaff: false,
    mfaVerified: false,
    recentAuthenticationVerified: true,
  },
} as const satisfies Record<
  string,
  {
    userId: string;
    organizationId: string;
    accountIds: readonly string[];
    roles: readonly Role[];
    permissions: readonly Permission[];
    isInternalStaff: boolean;
    mfaVerified: boolean;
    recentAuthenticationVerified: boolean;
  }
>;
