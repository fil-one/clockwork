import type { MessageId, Translator } from "@/src/i18n";
import { CommerceApiError } from "@/src/features/contracts/commerce-client";
import {
  formatMoney,
  type SupportedCurrency,
} from "@/src/features/shared/format";

import styles from "./administration-safety.module.css";

/*
 * Presentation shared by the price-book, catalog and PAYG administration
 * surfaces. Everything here turns a stored fact (a status, a code, minor units,
 * basis points) into text for the reader at render time; nothing here stores
 * or compares rendered text.
 */

export type PriceBookStatus = "draft" | "active" | "retired";

/**
 * Price-book states agree with "price book" (feminine in es, fr, pt and ar),
 * so they are this lane's own labels rather than the generic `status.*` ones.
 */
export const priceBookStatusLabels: Readonly<
  Record<PriceBookStatus, MessageId>
> = {
  draft: "adminPricing.bookStatus.draft",
  active: "adminPricing.bookStatus.active",
  retired: "adminPricing.bookStatus.retired",
};

export type PillTone = "success" | "warning" | "danger";

const priceBookStatusTones: Readonly<Record<PriceBookStatus, PillTone>> = {
  draft: "warning",
  active: "success",
  retired: "danger",
};

/**
 * A status pill whose colour is chosen from a fact, not from its words.
 *
 * The shared `StatusPill` picks its tone by searching the English label for
 * "active" or "retired"; once the label is German or Arabic that search finds
 * nothing and every pill turns amber. The tone is passed in instead.
 */
export function PricingPill({
  label,
  tone,
}: {
  label: string;
  tone: PillTone;
}) {
  return <span className={`${styles.pill} ${styles[tone]}`}>{label}</span>;
}

export function PriceBookStatusPill({
  status,
  t,
}: {
  status: PriceBookStatus;
  t: Translator;
}) {
  return (
    <PricingPill
      label={t(priceBookStatusLabels[status])}
      tone={priceBookStatusTones[status]}
    />
  );
}

/** Minor units in the record's currency, grouped for the reader. */
export function bookMoney(
  value: { readonly currency: string; readonly minor: string },
  locale: string,
): string {
  return formatMoney(value.minor, value.currency as SupportedCurrency, locale);
}

/** A decimal quantity string ("1", "0.5") in the reader's number format. */
export function formatQuantity(value: string, locale: string): string {
  if (!/^-?\d+(?:\.\d+)?$/u.test(value)) return value;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 20 }).format(
    value as Intl.StringNumericLiteral,
  );
}

/** Basis points as a grouped count and as the percentage they stand for. */
export function formatBasisPoints(
  bps: number,
  locale: string,
): { bps: string; percent: string } {
  return {
    bps: new Intl.NumberFormat(locale).format(bps),
    percent: new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 2,
    }).format(bps / 10_000),
  };
}

const commitTypeLabels: Readonly<Record<string, MessageId>> = {
  term_drawdown: "adminPricing.commitType.termDrawdown",
  period_allowance: "adminPricing.commitType.periodAllowance",
};

/** The commitment model's label; an unknown stored code is shown as stored. */
export function commitTypeLabel(value: string, t: Translator): string {
  const id = commitTypeLabels[value];
  return id ? t(id) : value;
}

/**
 * The billing unit a rate is sold in. "TB-month" is the unit every seeded and
 * bootstrapped rate uses, so it has a label in each language; any other unit a
 * finance user typed is their text and is shown as typed.
 */
export function unitLabel(unit: string, t: Translator): string {
  return unit === "TB-month" ? t("adminPricing.unit.tbMonth") : unit;
}

/** "1 TB-month", with the quantity in the reader's number format. */
export function rateQuantityText(
  quantity: string,
  unit: string,
  t: Translator,
  locale: string,
): string {
  const formatted = formatQuantity(quantity, locale);
  return unit === "TB-month"
    ? t("adminPricing.unit.tbMonthQuantity", { quantity: formatted })
    : t("adminPricing.unit.quantity", { quantity: formatted, unit });
}

/** Egress treatment is free text; the seeded value "metered" has a label. */
export function egressTreatmentLabel(value: string, t: Translator): string {
  return value === "metered" ? t("adminPricing.egress.metered") : value;
}

/**
 * The reader's sentence for a failed pricing command.
 *
 * The commerce client carries a coarse class (`code`) and an English sentence.
 * The class decides the message here. A validation refusal also carries the
 * server's own explanation, which is quoted because it names the field that
 * failed; everything else gets `fallback`, the surface's own "nothing
 * changed" sentence.
 */
export function commerceErrorText(
  error: unknown,
  t: Translator,
  fallback: MessageId,
): string {
  if (!(error instanceof CommerceApiError)) return t(fallback);
  if (error.code === "forbidden") return t("adminPricing.error.forbidden");
  if (error.code === "conflict") return t("adminPricing.error.conflict");
  if (error.code === "unavailable") return t("adminPricing.error.unavailable");
  if (error.code === "validation")
    return t("adminPricing.error.validation", { detail: error.message });
  return t(fallback);
}
