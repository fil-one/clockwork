import type { Role } from "@clockwork/contracts";

export const DEMO_PERSONA_HEADER = "x-clockwork-persona";
export const DEMO_ACCOUNT_HEADER = "x-clockwork-account";
export const DEMO_MFA_HEADER = "x-clockwork-mfa";

export type DemoPersonaKind =
  | "direct_buyer"
  | "referral_partner"
  | "reseller"
  | "distributor"
  | "end_client"
  | "billing_user"
  | "legal_approver"
  | "finance_approver"
  | "internal_operator";

export type DemoPersonaKey =
  | "billingUser"
  | "directBuyer"
  | "distributor"
  | "endClient"
  | "financeApprover"
  | "internalOperator"
  | "legalApprover"
  | "referralPartner"
  | "reseller";

export interface DemoPersona {
  readonly key: DemoPersonaKey;
  readonly kind: DemoPersonaKind;
  readonly displayName: string;
  readonly jobTitle: string;
  readonly email: `${string}@${string}.test`;
  readonly userId: string;
  readonly organizationId: string;
  readonly selectedAccountId: string;
  readonly accessibleAccountIds: readonly string[];
  readonly role: Role;
  readonly startRoute: `/${string}`;
  readonly locale: "en-GB" | "en-US";
  readonly timeZone: string;
  readonly currency: "EUR" | "GBP" | "USD";
  readonly mfaVerified: true;
  readonly isInternalStaff: boolean;
  readonly assistedAccountId?: string;
  readonly journeyIntent: string;
}

const userIds = {
  directBuyer: "21000000-0000-4000-8000-000000000001",
  referralPartner: "21000000-0000-4000-8000-000000000002",
  reseller: "21000000-0000-4000-8000-000000000003",
  distributor: "21000000-0000-4000-8000-000000000004",
  endClient: "21000000-0000-4000-8000-000000000005",
  billingUser: "21000000-0000-4000-8000-000000000006",
  legalApprover: "21000000-0000-4000-8000-000000000007",
  financeApprover: "21000000-0000-4000-8000-000000000008",
  internalOperator: "21000000-0000-4000-8000-000000000009",
} as const;

export const demoAccountIds = {
  direct: "11000000-0000-4000-8000-000000000001",
  referral: "11000000-0000-4000-8000-000000000002",
  reseller: "11000000-0000-4000-8000-000000000003",
  distributor: "11000000-0000-4000-8000-000000000004",
  endClient: "11000000-0000-4000-8000-000000000005",
  resaleEndClient: "11000000-0000-4000-8000-000000000006",
  ukEndClient: "11000000-0000-4000-8000-000000000007",
} as const;

const organizationIds = {
  direct: "31000000-0000-4000-8000-000000000001",
  referral: "31000000-0000-4000-8000-000000000002",
  reseller: "31000000-0000-4000-8000-000000000003",
  distributor: "31000000-0000-4000-8000-000000000004",
  endClient: "31000000-0000-4000-8000-000000000005",
  internal: "31000000-0000-4000-8000-000000000009",
} as const;

export const demoPersonas = {
  directBuyer: {
    key: "directBuyer",
    kind: "direct_buyer",
    displayName: "Mara Voss",
    jobTitle: "Operations Director",
    email: "mara.voss@meridian-archive.test",
    userId: userIds.directBuyer,
    organizationId: organizationIds.direct,
    selectedAccountId: demoAccountIds.direct,
    accessibleAccountIds: [demoAccountIds.direct],
    role: "owner",
    startRoute: "/client/dashboard",
    locale: "en-US",
    timeZone: "America/New_York",
    currency: "USD",
    mfaVerified: true,
    isInternalStaff: false,
    journeyIntent: "Accept the renewal quote before its notice window opens.",
  },
  referralPartner: {
    key: "referralPartner",
    kind: "referral_partner",
    displayName: "Jon Bell",
    jobTitle: "Alliance Manager",
    email: "jon.bell@northstar-advisory.test",
    userId: userIds.referralPartner,
    organizationId: organizationIds.referral,
    selectedAccountId: demoAccountIds.referral,
    accessibleAccountIds: [demoAccountIds.referral, demoAccountIds.endClient],
    role: "partner_seller",
    startRoute: "/partner/deals",
    locale: "en-US",
    timeZone: "America/Chicago",
    currency: "USD",
    mfaVerified: true,
    isInternalStaff: false,
    journeyIntent: "Resolve a protected-deal dispute and review attribution.",
  },
  reseller: {
    key: "reseller",
    kind: "reseller",
    displayName: "Priya Nair",
    jobTitle: "Commercial Director",
    email: "priya.nair@ember-peak.test",
    userId: userIds.reseller,
    organizationId: organizationIds.reseller,
    selectedAccountId: demoAccountIds.reseller,
    accessibleAccountIds: [
      demoAccountIds.reseller,
      demoAccountIds.resaleEndClient,
    ],
    role: "partner_admin",
    startRoute: "/partner",
    locale: "en-GB",
    timeZone: "Europe/London",
    currency: "GBP",
    mfaVerified: true,
    isInternalStaff: false,
    journeyIntent:
      "Act on the partner agreement clock, then issue an end-client quote.",
  },
  distributor: {
    key: "distributor",
    kind: "distributor",
    displayName: "Elias Ward",
    jobTitle: "Channel Operations Lead",
    email: "elias.ward@harborline-distribution.test",
    userId: userIds.distributor,
    organizationId: organizationIds.distributor,
    selectedAccountId: demoAccountIds.distributor,
    accessibleAccountIds: [
      demoAccountIds.distributor,
      demoAccountIds.reseller,
      demoAccountIds.ukEndClient,
    ],
    role: "partner_admin",
    startRoute: "/partner/portfolio",
    locale: "en-GB",
    timeZone: "Europe/London",
    currency: "GBP",
    mfaVerified: true,
    isInternalStaff: false,
    journeyIntent: "Review a two-tier quote and consolidated billing exposure.",
  },
  endClient: {
    key: "endClient",
    kind: "end_client",
    displayName: "Nora Chen",
    jobTitle: "Platform Engineer",
    email: "nora.chen@lumen-field.test",
    userId: userIds.endClient,
    organizationId: organizationIds.endClient,
    selectedAccountId: demoAccountIds.endClient,
    accessibleAccountIds: [demoAccountIds.endClient],
    role: "member",
    startRoute: "/client/services",
    locale: "en-US",
    timeZone: "America/Los_Angeles",
    currency: "USD",
    mfaVerified: true,
    isInternalStaff: false,
    journeyIntent: "Review entitlement usage without partner commercial data.",
  },
  billingUser: {
    key: "billingUser",
    kind: "billing_user",
    displayName: "Theo Grant",
    jobTitle: "Accounts Payable Manager",
    email: "theo.grant@meridian-archive.test",
    userId: userIds.billingUser,
    organizationId: organizationIds.direct,
    selectedAccountId: demoAccountIds.direct,
    accessibleAccountIds: [demoAccountIds.direct],
    role: "billing",
    startRoute: "/client/billing",
    locale: "en-US",
    timeZone: "America/New_York",
    currency: "USD",
    mfaVerified: true,
    isInternalStaff: false,
    journeyIntent: "Resolve an overdue invoice and download its receipt.",
  },
  legalApprover: {
    key: "legalApprover",
    kind: "legal_approver",
    displayName: "Imani Ross",
    jobTitle: "Commercial Counsel",
    email: "imani.ross@fil-one-internal.test",
    userId: userIds.legalApprover,
    organizationId: organizationIds.internal,
    selectedAccountId: demoAccountIds.direct,
    accessibleAccountIds: [],
    role: "legal_approver",
    startRoute: "/internal/approvals/legal",
    locale: "en-US",
    timeZone: "America/New_York",
    currency: "USD",
    mfaVerified: true,
    isInternalStaff: true,
    journeyIntent: "Review customer paper and its material renewal variance.",
  },
  financeApprover: {
    key: "financeApprover",
    kind: "finance_approver",
    displayName: "Mateo Silva",
    jobTitle: "Finance Controller",
    email: "mateo.silva@fil-one-internal.test",
    userId: userIds.financeApprover,
    organizationId: organizationIds.internal,
    selectedAccountId: demoAccountIds.distributor,
    accessibleAccountIds: [],
    role: "finance_approver",
    startRoute: "/internal/approvals/finance",
    locale: "en-US",
    timeZone: "America/New_York",
    currency: "USD",
    mfaVerified: true,
    isInternalStaff: true,
    journeyIntent: "Decide a below-floor distributor pricing exception.",
  },
  internalOperator: {
    key: "internalOperator",
    kind: "internal_operator",
    displayName: "Ada Mercer",
    jobTitle: "Commerce Operations",
    email: "ada.mercer@fil-one-internal.test",
    userId: userIds.internalOperator,
    organizationId: organizationIds.internal,
    selectedAccountId: demoAccountIds.reseller,
    accessibleAccountIds: [],
    role: "internal_operator",
    startRoute: "/internal/queues",
    locale: "en-US",
    timeZone: "America/New_York",
    currency: "USD",
    mfaVerified: true,
    isInternalStaff: true,
    assistedAccountId: demoAccountIds.reseller,
    journeyIntent:
      "Recover a failed provisioning run in a time-limited assisted session.",
  },
} as const satisfies Record<DemoPersonaKey, DemoPersona>;

export function demoPersonaHeaders(persona: DemoPersonaKey) {
  const value = demoPersonas[persona];
  return {
    [DEMO_PERSONA_HEADER]: value.role,
    [DEMO_ACCOUNT_HEADER]: value.selectedAccountId,
    [DEMO_MFA_HEADER]: String(value.mfaVerified),
  } as const;
}

export function getDemoPersona(persona: DemoPersonaKey): DemoPersona {
  return demoPersonas[persona];
}
