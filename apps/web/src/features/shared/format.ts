import { t } from "@/src/i18n/en";

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

export function formatMoney(
  minorUnits: string | number | bigint,
  currency: SupportedCurrency,
  locale: SupportedLocale = "en-US",
): string {
  const amount = BigInt(minorUnits);
  const negative = amount < 0n;
  const whole = (negative ? -amount : amount) / 100n;
  const fraction = (amount < 0n ? -amount : amount) % 100n;
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(whole);
  const formatted = parts
    .map((part) =>
      part.type === "fraction"
        ? new Intl.NumberFormat(locale, {
            useGrouping: false,
            minimumIntegerDigits: 2,
          }).format(fraction)
        : part.value,
    )
    .join("");
  return negative ? `-${formatted}` : formatted;
}

export function formatDate(
  value: string | Date,
  locale: SupportedLocale = "en-US",
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

export function taxLabel(country: "US" | "ES" | "GB"): string {
  if (country === "US") return t("format.tax.us");
  if (country === "ES") return t("format.tax.eu");
  return t("format.tax.uk");
}
