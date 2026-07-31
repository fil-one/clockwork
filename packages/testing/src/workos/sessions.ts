import type { Role } from "@clockwork/contracts";

export const workosSessions = {
  directOwner: {
    userId: "20000000-0000-4000-8000-000000000002",
    organizationId: "30000000-0000-4000-8000-000000000001",
    accountIds: ["10000000-0000-4000-8000-000000000001"],
    roles: ["owner"],
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
    isInternalStaff: false,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  },
  internalOperator: {
    userId: "20000000-0000-4000-8000-000000000001",
    organizationId: "30000000-0000-4000-8000-000000000008",
    accountIds: [],
    roles: ["internal_operator"],
    isInternalStaff: true,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  },
  privilegedWithoutMfa: {
    userId: "20000000-0000-4000-8000-000000000002",
    organizationId: "30000000-0000-4000-8000-000000000001",
    accountIds: ["10000000-0000-4000-8000-000000000001"],
    roles: ["admin"],
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
    isInternalStaff: boolean;
    mfaVerified: boolean;
    recentAuthenticationVerified: boolean;
  }
>;
