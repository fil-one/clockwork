import type { Route } from "next";

import {
  partnerErrorCodes,
  partnerListSearchParams,
  type PartnerDealModel,
  type PartnerDealStatus,
  type PartnerExclusivity,
  type PartnerListQuery,
  type PartnerModel,
  type PartnerStatus,
} from "@clockwork/contracts";

import type { MessageId } from "@/src/i18n";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const partnerModelLabels: Readonly<Record<PartnerModel, MessageId>> = {
  referral: "operations.partners.model.referral",
  resale: "operations.partners.model.resale",
  affiliate: "operations.partners.model.affiliate",
  distributor: "operations.partners.model.distributor",
  msp: "operations.partners.model.msp",
  teaming: "operations.partners.model.teaming",
  technology: "operations.partners.model.technology",
  other: "operations.partners.model.other",
};

export const partnerStatusLabels: Readonly<Record<PartnerStatus, MessageId>> = {
  prospect: "operations.partners.status.prospect",
  talking: "operations.partners.status.talking",
  negotiating: "operations.partners.status.negotiating",
  terms_agreed: "operations.partners.status.terms_agreed",
  signed: "operations.partners.status.signed",
  active: "operations.partners.status.active",
  paused: "operations.partners.status.paused",
  ended: "operations.partners.status.ended",
};

export const partnerStatusTone: Readonly<Record<PartnerStatus, Tone>> = {
  prospect: "neutral",
  talking: "info",
  negotiating: "info",
  terms_agreed: "warning",
  signed: "success",
  active: "success",
  paused: "neutral",
  ended: "neutral",
};

export const partnerExclusivityLabels: Readonly<
  Record<PartnerExclusivity, MessageId>
> = {
  none: "operations.partners.exclusivity.none",
  limited: "operations.partners.exclusivity.limited",
  exclusive: "operations.partners.exclusivity.exclusive",
};

export const partnerDealStatusLabels: Readonly<
  Record<PartnerDealStatus, MessageId>
> = {
  registered: "operations.partners.deal.status.registered",
  accepted: "operations.partners.deal.status.accepted",
  won: "operations.partners.deal.status.won",
  lost: "operations.partners.deal.status.lost",
  expired: "operations.partners.deal.status.expired",
  withdrawn: "operations.partners.deal.status.withdrawn",
  disputed: "operations.partners.deal.status.disputed",
};

export const partnerDealStatusTone: Readonly<Record<PartnerDealStatus, Tone>> =
  {
    registered: "info",
    accepted: "info",
    won: "success",
    lost: "neutral",
    expired: "neutral",
    withdrawn: "neutral",
    disputed: "danger",
  };

export const partnerDealModelLabels: Readonly<
  Record<PartnerDealModel, MessageId>
> = {
  referral: "operations.partners.deal.model.referral",
  resale: "operations.partners.deal.model.resale",
  other: "operations.partners.deal.model.other",
};

const otherErrors = [
  "INVALID_INPUT",
  "CONTRACT_FORBIDDEN",
  "CONTRACT_MFA_REQUIRED",
  "CONTRACT_DEMO_UNAVAILABLE",
  "SESSION_EXPIRED",
  "UNEXPECTED",
] as const;
type PartnerMessageCode =
  (typeof partnerErrorCodes)[number] | (typeof otherErrors)[number];

const errorMessages = Object.fromEntries(
  [...partnerErrorCodes, ...otherErrors].map((code) => [
    code,
    `operations.partners.error.${code}`,
  ]),
) as Record<PartnerMessageCode, MessageId>;

/** The message for an action's refusal; unknown codes read as unexpected. */
export function partnerErrorMessage(code: string): MessageId {
  return errorMessages[code as PartnerMessageCode] ?? errorMessages.UNEXPECTED;
}

/** What to say beside a field the server refused. */
export function partnerFieldMessage(code: string): MessageId {
  if (code.startsWith("percent"))
    return "operations.partners.form.percentError";
  if (code.startsWith("size")) return "operations.partners.form.sizeError";
  return "operations.partners.form.fieldError";
}

export const partnersPath = "/internal/partners" as Route;
export const partnerHref = (id: string) => `/internal/partners/${id}` as Route;
export const partnerEditHref = (id: string) =>
  `/internal/partners/${id}/edit` as Route;

/** The list with these filters, or the export with the same ones. */
export function partnerListHref(
  query: Partial<PartnerListQuery>,
  target: "list" | "export" = "list",
): Route {
  const search = partnerListSearchParams(query).toString();
  const base: string =
    target === "export" ? "/internal/partners/export" : partnersPath;
  return (search ? `${base}?${search}` : base) as Route;
}
