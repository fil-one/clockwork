import { createHash } from "node:crypto";

import type {
  FormattingLocale,
  Money,
  Party,
  PostalAddress,
  ServicePeriod,
} from "./model";

const INTEGER_PATTERN = /^-?\d+$/;
const CURRENCY_FRACTION_DIGITS = 2;

export function assertIsoInstant(value: string, fieldName = "instant"): Date {
  const parsed = new Date(value);
  if (
    Number.isNaN(parsed.valueOf()) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    throw new Error(`${fieldName} must be a UTC RFC 3339 instant`);
  }
  return parsed;
}

export function assertIsoDate(value: string, fieldName = "date"): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${fieldName} must be an ISO calendar date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error(`${fieldName} must be an ISO calendar date`);
  }
  return parsed;
}

export function formatDate(value: string, locale: FormattingLocale): string {
  const parsed = value.includes("T")
    ? assertIsoInstant(value)
    : assertIsoDate(value);
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(parsed);
}

export function formatDateTime(
  value: string,
  locale: FormattingLocale,
): string {
  const parsed = assertIsoInstant(value);
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
    year: "numeric",
  }).format(parsed);
}

export function formatMoney(value: Money, locale: FormattingLocale): string {
  if (!INTEGER_PATTERN.test(value.minorUnits)) {
    throw new Error("Money minorUnits must be a signed integer string");
  }

  const minorUnits = BigInt(value.minorUnits);
  const negative = minorUnits < 0n;
  const absolute = negative ? -minorUnits : minorUnits;
  const major = absolute / 100n;
  const fraction = absolute % 100n;
  const decimal = `${negative ? "-" : ""}${major.toString()}.${fraction
    .toString()
    .padStart(CURRENCY_FRACTION_DIGITS, "0")}` as `${number}`;

  return new Intl.NumberFormat(locale, {
    currency: value.currency,
    currencyDisplay: "symbol",
    maximumFractionDigits: CURRENCY_FRACTION_DIGITS,
    minimumFractionDigits: CURRENCY_FRACTION_DIGITS,
    style: "currency",
    useGrouping: true,
  }).format(decimal);
}

export function formatPercentFromBasisPoints(
  basisPoints: number,
  locale: FormattingLocale,
): string {
  if (!Number.isInteger(basisPoints)) {
    throw new Error("Basis points must be an integer");
  }
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    style: "percent",
  }).format(basisPoints / 10_000);
}

export function formatAddress(address: PostalAddress): readonly string[] {
  const localityLine =
    address.countryCode === "US"
      ? [address.locality, address.region].filter(Boolean).join(", ") +
        ` ${address.postalCode}`
      : [address.locality, address.region, address.postalCode]
          .filter(Boolean)
          .join(" ");

  return [
    address.line1,
    address.line2,
    localityLine,
    countryDisplayName(address.countryCode),
  ].filter((line): line is string => Boolean(line));
}

export function countryDisplayName(countryCode: string): string {
  const names: Readonly<Record<string, string>> = {
    ES: "Spain",
    GB: "United Kingdom",
    US: "United States",
  };
  return names[countryCode] ?? countryCode;
}

export function taxIdentityLabel(party: Party): string {
  if (
    party.address.countryCode === "GB" ||
    party.address.countryCode === "ES"
  ) {
    return "VAT number";
  }
  return "Tax ID";
}

export function formatPeriod(
  period: ServicePeriod,
  locale: FormattingLocale,
): string {
  return `${formatDate(period.startDate, locale)} - ${formatDate(
    period.endDate,
    locale,
  )}`;
}

export function groupHash(hash: string): string {
  return hash.match(/.{1,8}/g)?.join(" ") ?? hash;
}

export function normalizeSha256Hash(hash: string): string {
  return hash.replace(/^sha256:/i, "").toLowerCase();
}

export function slugifyFilePart(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return slug || "document";
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
