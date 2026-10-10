import { z } from "zod";

/**
 * Staff create a customer or partner organization, usually from a handoff.
 * The account behind it is screening-restricted until screening records
 * evidence, exactly as a self-registration is.
 */
export const onboardingSides = [
  "customer",
  "channel_partner",
  "referral_partner",
] as const;
export type OnboardingSide = (typeof onboardingSides)[number];

/** How a channel partner sells; a referral partner is always `referral`. */
export const channelAgreementTypes = ["resale", "msp", "embedded"] as const;

export const onboardingCurrencies = ["USD", "EUR", "GBP"] as const;

const noControl = (value: string) =>
  [...value].every((c) => c.charCodeAt(0) >= 32);
const line = (min: number, max: number) =>
  z.string().trim().min(min).max(max).refine(noControl, "control_character");
const optionalLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(noControl, "control_character")
    .optional()
    .transform((value) => value || undefined);
const email = z
  .email()
  .max(320)
  .transform((value) => value.toLowerCase());

export const OrganizationOnboardingInputSchema = z
  .object({
    /** The new organization's id, minted by the form so a retry is safe. */
    id: z.uuid(),
    handoffRequestId: z.guid().nullable().default(null),
    legalName: line(2, 200),
    side: z.enum(onboardingSides),
    channelAgreementType: z.enum(channelAgreementTypes).default("resale"),
    country: z.string().regex(/^[A-Z]{2}$/u, "country"),
    currency: z.enum(onboardingCurrencies),
    domain: z
      .string()
      .trim()
      .toLowerCase()
      .max(253)
      .regex(
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u,
        "domain",
      ),
    registeredAddress: z
      .object({
        line1: line(1, 200),
        line2: optionalLine(200),
        city: line(1, 120),
        region: optionalLine(120),
        postalCode: line(1, 40),
      })
      .strict(),
    billingContact: z.object({ name: line(1, 200), email }).strict(),
    invoiceDeliveryEmail: email,
  })
  .strict();

export interface OnboardedOrganization {
  organizationId: string;
  accountId: string;
  legalName: string;
  side: OnboardingSide;
}

/** Refusals organization set-up can return; the page words each one. */
export const onboardingErrorCodes = [
  "ONBOARDING_HANDOFF_NOT_IN_PROGRESS",
  "ONBOARDING_HANDOFF_SIDE_MISMATCH",
  "ONBOARDING_HANDOFF_ALREADY_HAS_ORGANIZATION",
  "ONBOARDING_ORGANIZATION_EXISTS",
  "ONBOARDING_ACCOUNT_EXISTS",
  "ONBOARDING_DOMAIN_TAKEN",
  "ONBOARDING_ORGANIZATION_NOT_FOUND",
] as const;
