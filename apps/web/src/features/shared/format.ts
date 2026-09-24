import type { Translator } from "@/src/i18n";

export type SupportedLocale =
  | "en-US"
  | "en-GB"
  | "es-ES"
  | "es"
  | "fr-FR"
  | "de-DE"
  | "ja-JP"
  | "pt-BR"
  | "zh-Hans-CN"
  | "ar-AE";
export type SupportedCurrency = "USD" | "EUR" | "GBP";

/**
 * Formats integer minor units in the record's currency with the reader's
 * formatting locale.
 *
 * `locale` is required and has no default: it is the interface language's
 * formatting tag (`formattingLocales[locale]`, or the route session's
 * `locale`), never the account's. The account decides the currency; the reader
 * decides how the digits are grouped. A default here is how a Portuguese page
 * came to show `$8,400.00`.
 */
export function formatMoney(
  minorUnits: string | number | bigint,
  currency: SupportedCurrency,
  locale: SupportedLocale | (string & {}),
): string {
  const amount = BigInt(minorUnits);
  const negative = amount < 0n;
  const whole = (negative ? -amount : amount) / 100n;
  const fraction = (negative ? -amount : amount) % 100n;
  // The sign is the locale's to place: ar-AE puts direction marks before the
  // minus, and a hand-prepended "-" landed outside them. A negative amount
  // under one unit has a whole part of 0n, which has no sign, so it is
  // formatted as the number -0, which does.
  const signedWhole = negative ? (whole === 0n ? -0 : -whole) : whole;
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(signedWhole);
  return parts
    .map((part) =>
      part.type === "fraction"
        ? new Intl.NumberFormat(locale, {
            useGrouping: false,
            minimumIntegerDigits: 2,
          }).format(fraction)
        : part.value,
    )
    .join("");
}

/** A calendar date (no time of day) in the reader's formatting locale. */
export function formatDate(
  value: string | Date,
  locale: SupportedLocale | (string & {}),
  style: "short" | "medium" | "long" = "medium",
): string {
  const date =
    typeof value === "string" ? new Date(`${value}T00:00:00Z`) : value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: style,
    timeZone: "UTC",
  }).format(date);
}

export function formatAddress(
  address: Readonly<{
    line1: string;
    city: string;
    region?: string;
    postalCode: string;
    country: string;
  }>,
): string {
  return [
    address.line1,
    [address.city, address.region].filter(Boolean).join(", "),
    address.postalCode,
    address.country,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function taxLabel(country: "US" | "ES" | "GB", t: Translator): string {
  if (country === "US") return t("format.tax.us");
  if (country === "ES") return t("format.tax.eu");
  return t("format.tax.uk");
}
