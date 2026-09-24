import { resolveDemoText } from "@clockwork/testing/demo-localized-text";

import { formatDate, formatMoney } from "@/src/features/shared/format";
import {
  formattingLocales,
  type Locale,
  type MessageId,
  type Translator,
} from "@/src/i18n";

import type {
  PartnerFixture,
  PartnerMilestone,
  PartnerPosition,
  PartnerRecord,
  PartnerRisk,
  PartnerStatus,
} from "./partner-data";

/** Status chips. The generic status set agrees with the implicit "record". */
export const partnerStatusLabels: Readonly<Record<PartnerStatus, MessageId>> = {
  active: "status.active",
  attention: "status.attention",
  draft: "status.draft",
  open: "status.open",
  accepted: "status.accepted",
  canceled: "status.canceled",
  pending: "status.pending",
  paid: "status.paid",
  blocked: "status.blocked",
  complete: "status.complete",
};

/** "High risk" on a chip; "High" where a column or card already says "Risk". */
export const partnerRiskChips: Readonly<Record<PartnerRisk, MessageId>> = {
  low: "risk.chip.low",
  medium: "risk.chip.medium",
  high: "risk.chip.high",
};
export const partnerRiskLevels: Readonly<Record<PartnerRisk, MessageId>> = {
  low: "risk.level.low",
  medium: "risk.level.medium",
  high: "risk.level.high",
};

/**
 * Commercial position and next milestone, from facts, in the reader's
 * language. Amounts and dates are formatted with the interface language's
 * formatting locale and only then placed into the message, so word order is
 * the translator's and the digits are the reader's.
 */
export function partnerPositionText(
  position: PartnerPosition,
  t: Translator,
  formatting: string,
): string {
  if (position.kind === "transferAndResale")
    return t("partner.position.transferAndResale", {
      transfer: formatMoney(
        position.transferMinor,
        position.currency,
        formatting,
      ),
      resale: formatMoney(position.resaleMinor, position.currency, formatting),
    });
  const amount = formatMoney(
    position.amountMinor,
    position.currency,
    formatting,
  );
  return position.kind === "collected"
    ? t("partner.position.collected", { amount })
    : t("partner.position.proposedResale", { amount });
}

export function partnerMilestoneText(
  milestone: PartnerMilestone,
  t: Translator,
  formatting: string,
): string {
  if (milestone.kind === "renewalDecisionDue")
    return t("partner.milestone.renewalDecisionDue", {
      date: formatDate(milestone.on, formatting),
    });
  if (milestone.kind === "commissionEligible")
    return t("partner.milestone.commissionEligible", {
      rate: new Intl.NumberFormat(formatting, {
        style: "percent",
        maximumFractionDigits: 2,
      }).format(milestone.rate),
    });
  return t("partner.milestone.qualificationDueToday");
}

const currencies = new Set(["USD", "EUR", "GBP"]);
const minor = (value: unknown): value is string =>
  typeof value === "string" && /^-?\d+$/u.test(value);

/** A position read back from projection data, which is untyped JSON. */
export function readPartnerPosition(
  value: unknown,
): PartnerPosition | undefined {
  if (!value || typeof value !== "object") return undefined;
  const fact = value as Record<string, unknown>;
  const currency = fact.currency;
  if (typeof currency !== "string" || !currencies.has(currency))
    return undefined;
  const code = currency as PartnerPosition["currency"];
  if (
    fact.kind === "transferAndResale" &&
    minor(fact.transferMinor) &&
    minor(fact.resaleMinor)
  )
    return {
      kind: "transferAndResale",
      currency: code,
      transferMinor: fact.transferMinor,
      resaleMinor: fact.resaleMinor,
    };
  if (
    (fact.kind === "collected" || fact.kind === "proposedResale") &&
    minor(fact.amountMinor)
  )
    return { kind: fact.kind, currency: code, amountMinor: fact.amountMinor };
  return undefined;
}

export function readPartnerMilestone(
  value: unknown,
): PartnerMilestone | undefined {
  if (!value || typeof value !== "object") return undefined;
  const fact = value as Record<string, unknown>;
  if (
    fact.kind === "renewalDecisionDue" &&
    typeof fact.on === "string" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(fact.on)
  )
    return { kind: "renewalDecisionDue", on: fact.on };
  if (fact.kind === "commissionEligible" && typeof fact.rate === "number")
    return { kind: "commissionEligible", rate: fact.rate };
  if (fact.kind === "qualificationDueToday")
    return { kind: "qualificationDueToday" };
  return undefined;
}

/**
 * A fixture exactly as the demo read path presents it: demo-authored text
 * resolved to `locale`, facts rendered through messages. Component tests use
 * this to render fixtures without a projection source in between.
 */
export function presentPartnerFixture(
  fixture: PartnerFixture,
  t: Translator,
  locale: Locale,
): PartnerRecord {
  const formatting = formattingLocales[locale];
  const { position, milestone, value, secondary, context, ...record } = fixture;
  return {
    ...record,
    context: resolveDemoText(context, locale),
    value: position
      ? partnerPositionText(position, t, formatting)
      : (value ?? ""),
    secondary: milestone
      ? partnerMilestoneText(milestone, t, formatting)
      : (secondary ?? ""),
  };
}
