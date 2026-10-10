import type { MessageId, Translator } from "@/src/i18n";

import type { IndicativePriceBook } from "./books";

/** Product names a seller says aloud; an unknown SKU shows as it is. */
const productNames: Readonly<Record<string, MessageId>> = {
  "LOCKED-STORAGE-TB": "operations.sales.pricing.product.lockedStorage",
  "STORAGE-TB": "operations.sales.pricing.product.storage",
  "ARCHIVE-TB": "operations.sales.pricing.product.archive",
};

/** Region names with their location; an unknown code shows as it is. */
const regionNames: Readonly<Record<string, MessageId>> = {
  "us-east-1": "operations.sales.pricing.region.usEast1",
  "us-east-2": "operations.sales.pricing.region.usEast2",
  "us-west-2": "operations.sales.pricing.region.usWest2",
  "uk-south": "operations.sales.pricing.region.ukSouth",
};

export function productName(sku: string, t: Translator): string {
  const id = productNames[sku];
  return id ? t(id) : sku;
}

export function regionName(region: string, t: Translator): string {
  const id = regionNames[region];
  return id ? t(id) : region;
}

/**
 * The capacity unit of a monthly rate: "TB" for "TB-month". Indicative
 * prices are per unit per month, so the term is entered once, as months.
 */
export function capacityUnit(unit: string): string {
  return unit.replace(/-month$/u, "");
}

/** "Direct commerce (USD), version 2", without the currency said twice. */
export function bookLabel(book: IndicativePriceBook, t: Translator): string {
  const suffix = ` ${book.currency}`;
  return t("operations.sales.pricing.bookOption", {
    name: book.name.endsWith(suffix)
      ? book.name.slice(0, -suffix.length)
      : book.name,
    currency: book.currency,
    version: String(book.version),
  });
}
