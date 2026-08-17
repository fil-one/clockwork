import { merchantOfRecord } from "@clockwork/domain/core";

import type { PartnerRole, PartnerStatus } from "./partner-data";

export type AttributionRoute = Parameters<typeof merchantOfRecord>[0];

/**
 * Explains the commercial consequence of the persisted route without creating
 * a separate attribution fact. Partner routes reach quoting only with an
 * approved registration, while merchant ownership is derived by the same
 * domain rule used when the quote commercial profile is persisted.
 */
export function attributionStatement(
  route: AttributionRoute,
  partner: string,
): string {
  const merchant = merchantOfRecord(route);
  const merchantName =
    merchant === "fil_one"
      ? "Fil One"
      : merchant === "partner"
        ? partner
        : "The marketplace";
  const attribution =
    route === "direct" || route === "marketplace"
      ? "No partner attribution applies to this route."
      : `${partner} is the sourced partner because this route binds an approved deal registration.`;
  return `${attribution} Merchant of record: ${merchantName}.`;
}

/**
 * The registration projection uses `accepted` for the repository's `approved`
 * outcome. Only that outcome can state sourced credit: the repository derives
 * approved => sourced and every other persisted status => none.
 */
export function registrationCreditLabel(status: PartnerStatus): string {
  if (status === "accepted") return "Attribution: sourced";
  if (status === "pending") return "Attribution: decision pending";
  return "Attribution: no sourced credit recorded";
}

export type PartnerQuoteAction =
  "edit" | "issue" | "cancel" | "revise" | "download";

export function currentPartnerRole(
  roles: readonly string[],
): PartnerRole | null {
  if (roles.includes("partner_admin")) return "partner_admin";
  if (roles.includes("partner_seller")) return "partner_seller";
  return null;
}

export function roleCanUseSurface(
  roles: readonly string[],
  allowed: readonly PartnerRole[],
): boolean {
  const role = currentPartnerRole(roles);
  return Boolean(role && allowed.includes(role));
}

export function validPartnerQuoteActions(
  status: PartnerStatus,
  role: PartnerRole,
): readonly PartnerQuoteAction[] {
  if (status === "draft") return ["edit", "issue", "cancel"];
  if (status === "open") return ["cancel", "revise", "download"];
  if (status === "accepted") return ["download"];
  if (status === "canceled") return role === "partner_admin" ? ["revise"] : [];
  return [];
}

export interface RenewalReviewInput {
  client: string;
  action: "renew" | "change_term" | "request_change";
  currentEnd: string;
  requestedMonths: number | null;
  transferPrice: string;
  resalePrice: string;
  merchantOfRecord: string;
}

export function renewalReviewSummary(
  input: RenewalReviewInput,
): readonly string[] {
  const action =
    input.action === "renew"
      ? "Renew on the current commercial structure"
      : input.action === "change_term"
        ? `Change the term to ${input.requestedMonths ?? "an unselected number of"} months`
        : "Request a commercial change without committing it";
  return [
    `${input.client}: ${action}`,
    `Current service term ends ${input.currentEnd}`,
    `Fil One transfer price: ${input.transferPrice}`,
    `Partner resale price: ${input.resalePrice}`,
    `Merchant of record: ${input.merchantOfRecord}`,
  ];
}

export function partnerRoleSummary(role: PartnerRole): readonly string[] {
  return role === "partner_admin"
    ? [
        "Can manage billing, renewal requests, POCs, and brand settings.",
        "Can create and issue partner quotes.",
        "Cannot make Fil One operations or provider decisions.",
      ]
    : [
        "Can view the portfolio, register opportunities, and create partner quotes.",
        "Cannot view partner billing or commissions.",
        "Cannot submit renewal, POC, or brand changes.",
      ];
}
