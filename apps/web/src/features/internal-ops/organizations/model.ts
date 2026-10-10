import {
  onboardingErrorCodes,
  type OrganizationSide,
} from "@clockwork/contracts";

import type { MessageId } from "@/src/i18n";

export const organizationSideLabels: Readonly<
  Record<OrganizationSide, MessageId>
> = {
  customer: "operations.organizations.side.customer",
  channel_partner: "operations.organizations.side.channel_partner",
  referral_partner: "operations.organizations.side.referral_partner",
  fil_one: "operations.organizations.side.fil_one",
};

/** Labels for the roles a customer or partner member can hold. */
export const memberRoleLabels: Readonly<Record<string, MessageId>> = {
  owner: "role.owner",
  admin: "role.admin",
  billing: "role.billing",
  member: "role.member",
  partner_admin: "role.partnerAdmin",
  partner_seller: "role.partnerSeller",
};

const otherErrors = [
  "INVITE_ORGANIZATION_NOT_FOUND",
  "INVITE_ROLE_NOT_ALLOWED_ON_SIDE",
  "INVITE_ALREADY_PENDING",
  "INVITE_ALREADY_MEMBER",
  "INVITE_UNAVAILABLE",
  "INVITE_NOT_FOUND",
  "INVITE_NOT_PENDING",
  "HANDOFF_NOT_FOUND",
  "INVALID_INPUT",
  "CONTRACT_FORBIDDEN",
  "CONTRACT_MFA_REQUIRED",
  "CONTRACT_DEMO_UNAVAILABLE",
  "SESSION_EXPIRED",
  "UNEXPECTED",
] as const;
type Code =
  (typeof onboardingErrorCodes)[number] | (typeof otherErrors)[number];

const errorMessages = Object.fromEntries(
  [...onboardingErrorCodes, ...otherErrors].map((code) => [
    code,
    `operations.organizations.error.${code}`,
  ]),
) as Record<Code, MessageId>;

/** The message for a refusal; unknown codes read as unexpected. */
export function organizationErrorMessage(code: string): MessageId {
  return errorMessages[code as Code] ?? errorMessages.UNEXPECTED;
}

/** The domain of an email address, to suggest the business domain. */
export function emailDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

const countryNames = new Intl.DisplayNames(["en"], {
  type: "region",
  fallback: "none",
});

/**
 * The English name of a two-letter country code, or null when the code is
 * not one Intl can name. ZZ is the "Unknown Region" placeholder.
 */
export function resolveCountry(code: string): string | null {
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/u.test(upper) || upper === "ZZ") return null;
  return countryNames.of(upper) ?? null;
}

/** A stored country by name, or its code when Intl cannot name it. */
export function countryName(code: string): string {
  return resolveCountry(code) ?? code;
}
