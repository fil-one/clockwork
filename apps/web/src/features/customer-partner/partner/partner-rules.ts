import { merchantOfRecord } from "@clockwork/domain/core";

import type { MessageId, Translator } from "@/src/i18n";

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
  t: Translator,
): string {
  const merchant = merchantOfRecord(route);
  const attribution =
    route === "direct" || route === "marketplace"
      ? t("partner.attribution.none")
      : t("partner.attribution.sourced", { partner });
  const merchantStatement =
    merchant === "fil_one"
      ? t("partner.attribution.merchantFilOne")
      : merchant === "partner"
        ? t("partner.attribution.merchantPartner", { partner })
        : t("partner.attribution.merchantMarketplace");
  return t("common.join.sentences", {
    first: attribution,
    second: merchantStatement,
  });
}

/**
 * The registration projection uses `accepted` for the repository's `approved`
 * outcome. Only that outcome can state sourced credit: the repository derives
 * approved => sourced and every other persisted status => none.
 */
export function registrationCreditLabel(status: PartnerStatus): MessageId {
  if (status === "accepted")
    return "partner.collection.registrationCredit.sourced";
  if (status === "pending")
    return "partner.collection.registrationCredit.pending";
  return "partner.collection.registrationCredit.none";
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

const renewalActions = {
  renew: "partner.renewal.review.renew",
  change_term: "partner.renewal.review.changeTerm",
  request_change: "partner.renewal.review.requestChange",
} as const satisfies Record<RenewalReviewInput["action"], MessageId>;

export function renewalReviewSummary(
  input: RenewalReviewInput,
  t: Translator,
): readonly string[] {
  const action =
    input.action === "change_term" && input.requestedMonths === null
      ? t("partner.renewal.review.changeTermUnselected")
      : t(renewalActions[input.action], {
          count: input.requestedMonths ?? 0,
        });
  return [
    t("partner.renewal.review.clientAction", { client: input.client, action }),
    t("partner.renewal.review.currentEnd", { date: input.currentEnd }),
    t("partner.renewal.review.transferPrice", { amount: input.transferPrice }),
    t("partner.renewal.review.resalePrice", { amount: input.resalePrice }),
    t("partner.renewal.review.merchant", { merchant: input.merchantOfRecord }),
  ];
}

export function partnerRoleSummary(
  role: PartnerRole,
  t: Translator,
): readonly string[] {
  return role === "partner_admin"
    ? [
        t("partner.role.admin.manage"),
        t("partner.role.admin.quotes"),
        t("partner.role.admin.limit"),
      ]
    : [
        t("partner.role.seller.work"),
        t("partner.role.seller.noBilling"),
        t("partner.role.seller.noChanges"),
      ];
}
