import { resolveDemoText } from "@clockwork/testing/demo-localized-text";

import { formatDate, formatMoney } from "@/src/features/shared/format";
import {
  formattingLocales,
  type Locale,
  type MessageId,
  type Translator,
} from "@/src/i18n";

import {
  partnerDatedMilestoneKinds,
  partnerLabelMilestoneKinds,
  partnerLabelPositionKinds,
  partnerMoneyPositionKinds,
  type PartnerDatedMilestoneKind,
  type PartnerFixture,
  type PartnerLabelMilestoneKind,
  type PartnerLabelPositionKind,
  type PartnerMilestone,
  type PartnerMoneyPositionKind,
  type PartnerPosition,
  type PartnerRecord,
  type PartnerRisk,
  type PartnerStatus,
} from "./partner-data";
import { quoteRouteLabel, type QuoteRoute } from "./resale-quote-model";

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
 * Who is reading: their translator, their interface language (which demo
 * authored text resolves to) and the tag amounts and dates are formatted with.
 */
export interface PartnerReader {
  readonly t: Translator;
  readonly locale: Locale;
  readonly formatting: string;
}

/**
 * A storage quantity in the reader's locale: "320 TB", "320 To",
 * "320 تيرابايت". `terabytes` is the decimal string the quantity schema stores.
 */
export function formatTerabytes(
  terabytes: string | number,
  formatting: string,
): string {
  const value = Number(terabytes);
  if (!Number.isFinite(value)) return String(terabytes);
  return new Intl.NumberFormat(formatting, {
    style: "unit",
    unit: "terabyte",
    maximumFractionDigits: 3,
  }).format(value);
}

/** "18 minutes ago" in the reader's language, from a count of minutes. */
export function formatMinutesAgo(minutes: number, formatting: string): string {
  return new Intl.RelativeTimeFormat(formatting, { numeric: "auto" }).format(
    -minutes,
    "minute",
  );
}

/** One quoted line as facts: capacity in TB, a rate-card region, a term. */
export interface PartnerQuoteLineFacts {
  readonly quantity: string;
  readonly region: string;
  readonly termMonths: number;
}

/** "40 TB · uk-south · 12 months", worded and ordered by the reader's language. */
export function partnerQuoteLineText(
  line: PartnerQuoteLineFacts,
  t: Translator,
  formatting: string,
): string {
  return t("partner.quote.line", {
    capacity: formatTerabytes(line.quantity, formatting),
    region: line.region,
    term: t("partner.term.months", { count: line.termMonths }),
  });
}

/** Several quoted lines as one list in the reader's language. */
export function partnerQuoteLinesText(
  lines: readonly PartnerQuoteLineFacts[],
  t: Translator,
  formatting: string,
): string {
  return new Intl.ListFormat(formatting, { type: "conjunction" }).format(
    lines.map((line) => partnerQuoteLineText(line, t, formatting)),
  );
}

/** A quote's context line: its commercial route, then what it covers. */
export function partnerQuoteContextText(
  route: QuoteRoute,
  lines: readonly PartnerQuoteLineFacts[],
  t: Translator,
  formatting: string,
): string {
  return t("partner.quote.context", {
    route: t(quoteRouteLabel(route)),
    lines: partnerQuoteLinesText(lines, t, formatting),
  });
}

const moneyPositionMessages = {
  collected: "partner.position.collected",
  proposedResale: "partner.position.proposedResale",
  estimatedResale: "partner.position.estimatedResale",
  invoiced: "partner.position.invoiced",
  paid: "partner.position.paid",
  atRisk: "partner.position.atRisk",
  disputed: "partner.position.disputed",
  accrued: "partner.position.accrued",
  earned: "partner.position.earned",
  annualCollected: "partner.position.annualCollected",
  buyerPrice: "partner.position.buyerPrice",
} as const satisfies Record<PartnerMoneyPositionKind, MessageId>;

const labelPositionMessages = {
  domainVerified: "partner.position.domainVerified",
  dnsVerificationRequested: "partner.position.dnsVerificationRequested",
  externalGate: "partner.position.externalGate",
  normalPriority: "partner.position.normalPriority",
} as const satisfies Record<PartnerLabelPositionKind, MessageId>;

function isMoneyPosition(
  position: PartnerPosition,
): position is Extract<PartnerPosition, { amountMinor: string }> {
  return (partnerMoneyPositionKinds as readonly string[]).includes(
    position.kind,
  );
}

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
  if (isMoneyPosition(position))
    return t(moneyPositionMessages[position.kind], {
      amount: formatMoney(position.amountMinor, position.currency, formatting),
    });
  switch (position.kind) {
    case "capacityUsed":
      return t("partner.position.capacityUsed", {
        percent: new Intl.NumberFormat(formatting, {
          style: "percent",
          maximumFractionDigits: 1,
        }).format(position.ratio),
      });
    case "testsPassed":
      return t("partner.position.testsPassed", {
        count: position.total,
        passed: new Intl.NumberFormat(formatting).format(position.passed),
      });
    case "potentialWorkload":
      return t("partner.position.potentialWorkload", {
        capacity: formatTerabytes(position.terabytes, formatting),
      });
    case "updatedMinutesAgo":
      return t("common.updatedRelative", {
        relative: formatMinutesAgo(position.minutes, formatting),
      });
    default:
      return t(labelPositionMessages[position.kind]);
  }
}

const datedMilestoneMessages = {
  renewalDecisionDue: "partner.milestone.renewalDecisionDue",
  paymentConfirmed: "partner.milestone.paymentConfirmed",
  responseDue: "partner.milestone.responseDue",
  expires: "common.expiresOn",
  acceptedOn: "partner.milestone.acceptedOn",
  noticeActionDue: "partner.milestone.noticeActionDue",
  noActionUntil: "partner.milestone.noActionUntil",
  draftExpires: "partner.milestone.draftExpires",
  issuedExpires: "partner.milestone.issuedExpires",
} as const satisfies Record<PartnerDatedMilestoneKind, MessageId>;

const labelMilestoneMessages = {
  qualificationDueToday: "partner.milestone.qualificationDueToday",
  decisionDueToday: "partner.milestone.decisionDueToday",
  protectionCredited: "partner.milestone.protectionCredited",
  filOneReviewing: "partner.milestone.filOneReviewing",
  pricingReviewRequired: "partner.milestone.pricingReviewRequired",
  paysAfterCollection: "partner.milestone.paysAfterCollection",
  finalReportDueToday: "partner.milestone.finalReportDueToday",
  providerIsAcceptanceSource: "partner.milestone.providerIsAcceptanceSource",
  legalEntityDisclosed: "partner.milestone.legalEntityDisclosed",
  addTxtRecord: "partner.milestone.addTxtRecord",
  addVerificationRecord: "partner.milestone.addVerificationRecord",
  supportSystemIsSource: "partner.milestone.supportSystemIsSource",
  replyInSupportProvider: "partner.milestone.replyInSupportProvider",
  awaitingChannelDecision: "partner.milestone.awaitingChannelDecision",
  renewalRequested: "partner.milestone.renewalRequested",
  renewalDeclined: "partner.milestone.renewalDeclined",
  clientRequestedOrder: "partner.milestone.clientRequestedOrder",
  clientRequestedChanges: "partner.milestone.clientRequestedChanges",
  clientDeclined: "partner.milestone.clientDeclined",
} as const satisfies Record<PartnerLabelMilestoneKind, MessageId>;

function isDatedMilestone(
  milestone: PartnerMilestone,
): milestone is Extract<PartnerMilestone, { kind: PartnerDatedMilestoneKind }> {
  return (partnerDatedMilestoneKinds as readonly string[]).includes(
    milestone.kind,
  );
}

export function partnerMilestoneText(
  milestone: PartnerMilestone,
  t: Translator,
  formatting: string,
): string {
  if (isDatedMilestone(milestone))
    return t(datedMilestoneMessages[milestone.kind], {
      date: formatDate(milestone.on, formatting),
    });
  switch (milestone.kind) {
    case "commissionEligible":
      return t("partner.milestone.commissionEligible", {
        rate: new Intl.NumberFormat(formatting, {
          style: "percent",
          maximumFractionDigits: 2,
        }).format(milestone.rate),
      });
    case "invoiceDue":
      return t("partner.milestone.invoiceDue", {
        invoice: milestone.invoice,
        amount: formatMoney(
          milestone.amountMinor,
          milestone.currency,
          formatting,
        ),
        date: formatDate(milestone.on, formatting),
      });
    case "evidenceDueInDays":
      return t("partner.milestone.evidenceDueInDays", {
        count: milestone.days,
      });
    case "includedInStatement":
      return t("partner.milestone.includedInStatement", {
        statement: milestone.statement,
      });
    case "fulfillmentSynced":
      return t("partner.milestone.fulfillmentSynced", {
        relative: formatMinutesAgo(milestone.minutes, formatting),
      });
    case "supersededBy":
      return t("partner.milestone.supersededBy", {
        revision: milestone.revision,
      });
    case "withdrawn":
      return t("partner.milestone.withdrawn", { reason: milestone.reason });
    case "supplyOrderAccepted":
      return milestone.purchaseOrder
        ? t("partner.milestone.supplyOrderAcceptedWithPo", {
            purchaseOrder: milestone.purchaseOrder,
          })
        : t("partner.milestone.supplyOrderAccepted");
    default:
      return t(labelMilestoneMessages[milestone.kind]);
  }
}

const currencies = new Set(["USD", "EUR", "GBP"]);
const minor = (value: unknown): value is string =>
  typeof value === "string" && /^-?\d+$/u.test(value);
const isoDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
const oneOf = <T extends string>(
  values: readonly T[],
  value: unknown,
): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);

/** A position read back from projection data, which is untyped JSON. */
export function readPartnerPosition(
  value: unknown,
): PartnerPosition | undefined {
  if (!value || typeof value !== "object") return undefined;
  const fact = value as Record<string, unknown>;
  if (oneOf(partnerLabelPositionKinds, fact.kind)) return { kind: fact.kind };
  if (
    fact.kind === "capacityUsed" &&
    typeof fact.ratio === "number" &&
    Number.isFinite(fact.ratio)
  )
    return { kind: "capacityUsed", ratio: fact.ratio };
  if (
    fact.kind === "testsPassed" &&
    count(fact.passed) &&
    count(fact.total) &&
    fact.passed <= fact.total
  )
    return { kind: "testsPassed", passed: fact.passed, total: fact.total };
  if (
    fact.kind === "potentialWorkload" &&
    typeof fact.terabytes === "string" &&
    /^\d+(?:\.\d+)?$/u.test(fact.terabytes)
  )
    return { kind: "potentialWorkload", terabytes: fact.terabytes };
  if (fact.kind === "updatedMinutesAgo" && count(fact.minutes))
    return { kind: "updatedMinutesAgo", minutes: fact.minutes };
  const currency = fact.currency;
  if (typeof currency !== "string" || !currencies.has(currency))
    return undefined;
  const code = currency as "USD" | "EUR" | "GBP";
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
  if (oneOf(partnerMoneyPositionKinds, fact.kind) && minor(fact.amountMinor))
    return { kind: fact.kind, currency: code, amountMinor: fact.amountMinor };
  return undefined;
}

export function readPartnerMilestone(
  value: unknown,
): PartnerMilestone | undefined {
  if (!value || typeof value !== "object") return undefined;
  const fact = value as Record<string, unknown>;
  if (oneOf(partnerLabelMilestoneKinds, fact.kind)) return { kind: fact.kind };
  if (oneOf(partnerDatedMilestoneKinds, fact.kind) && isoDate(fact.on))
    return { kind: fact.kind, on: fact.on };
  if (fact.kind === "commissionEligible" && typeof fact.rate === "number")
    return { kind: "commissionEligible", rate: fact.rate };
  if (fact.kind === "evidenceDueInDays" && count(fact.days))
    return { kind: "evidenceDueInDays", days: fact.days };
  if (fact.kind === "includedInStatement" && typeof fact.statement === "string")
    return { kind: "includedInStatement", statement: fact.statement };
  if (fact.kind === "fulfillmentSynced" && count(fact.minutes))
    return { kind: "fulfillmentSynced", minutes: fact.minutes };
  if (fact.kind === "supersededBy" && count(fact.revision))
    return { kind: "supersededBy", revision: fact.revision };
  if (fact.kind === "withdrawn" && typeof fact.reason === "string")
    return { kind: "withdrawn", reason: fact.reason };
  if (fact.kind === "supplyOrderAccepted")
    return typeof fact.purchaseOrder === "string"
      ? { kind: "supplyOrderAccepted", purchaseOrder: fact.purchaseOrder }
      : { kind: "supplyOrderAccepted" };
  if (
    fact.kind === "invoiceDue" &&
    typeof fact.invoice === "string" &&
    minor(fact.amountMinor) &&
    isoDate(fact.on) &&
    typeof fact.currency === "string" &&
    currencies.has(fact.currency)
  )
    return {
      kind: "invoiceDue",
      invoice: fact.invoice,
      currency: fact.currency as "USD" | "EUR" | "GBP",
      amountMinor: fact.amountMinor,
      on: fact.on,
    };
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
  const {
    position,
    milestone,
    value,
    secondary,
    name,
    context,
    owner,
    ...record
  } = fixture;
  return {
    ...record,
    name: resolveDemoText(name, locale),
    context: resolveDemoText(context, locale),
    owner: resolveDemoText(owner, locale),
    value: position
      ? partnerPositionText(position, t, formatting)
      : (value ?? ""),
    secondary: milestone
      ? partnerMilestoneText(milestone, t, formatting)
      : (secondary ?? ""),
  };
}
