import "server-only";

import type {
  PricingScenarioLineInput,
  PricingScenarioRecord,
} from "@clockwork/contracts";
import {
  resolvePricingScenarioLines,
  type IndicativePriceBookRecord,
} from "@clockwork/db";

/** The demo's direct USD book and its first storage rate. */
const demoBookId = "66000000-0000-4000-8000-000000000001";
const demoRateId = "66100000-0000-4000-8000-000000000001";

type Example = Omit<
  PricingScenarioRecord,
  "asOf" | "priceBooks" | "lines" | "currency" | "createdAt" | "updatedAt"
> & {
  lines: readonly Omit<PricingScenarioLineInput, "bookId" | "rateId">[];
};

/**
 * Two fictional scenarios for the guided demo, written for a $5.99 per
 * TB-month list price: a reseller at $6.50 with a 32% margin, and a 10 PiB
 * referral whose commission steps down from 30% to 10% over three years.
 */
const examples: readonly Example[] = [
  {
    id: "019a44ac-0000-7000-8000-0000000de001",
    ownerId: "00000000-0000-4000-8000-000000000000",
    ownerName: "Demo",
    name: "Resale at $6.50, 32% margin",
    company: "Harborlight Media",
    notes: "",
    version: 1,
    lines: [{ quantity: "500", termMonths: 36, discountBps: 0 }],
    partnerEconomics: {
      model: "resale",
      partnerName: "Tidewater Systems",
      customerPriceMinor: "650",
      marginBps: 3200,
    },
  },
  {
    id: "019a44ac-0000-7000-8000-0000000de002",
    ownerId: "00000000-0000-4000-8000-000000000000",
    ownerName: "Demo",
    name: "Regional referral, 10 PiB",
    company: "Meridian Data Vaults",
    notes: "",
    version: 1,
    lines: [
      { quantity: "10", quantityUnit: "PiB", termMonths: 36, discountBps: 0 },
    ],
    partnerEconomics: {
      model: "referral",
      partnerName: "Copperline Partners",
      commissionBps: 3000,
      steps: [
        { fromMonth: 13, commissionBps: 2000 },
        { fromMonth: 25, commissionBps: 1000 },
      ],
    },
  },
];

/**
 * The demo examples priced from the demo books in force on `today`, as a
 * save would price them. They use the direct USD book's first storage rate,
 * or the first USD rate offered when the fixture changes; none appear when
 * the demo offers no USD book.
 */
export function demoPricingScenarios(
  books: readonly IndicativePriceBookRecord[],
  today: string,
): PricingScenarioRecord[] {
  const inForce = books.filter(
    (candidate) =>
      candidate.status === "active" &&
      candidate.effectiveFrom <= today &&
      (!candidate.effectiveTo || candidate.effectiveTo >= today),
  );
  const book =
    inForce.find(({ id }) => id === demoBookId) ??
    inForce.find(({ currency }) => currency === "USD");
  const rate =
    book?.rateCards?.find(({ id }) => id === demoRateId) ??
    book?.rateCards?.[0];
  if (!book || !rate) return [];
  try {
    return examples.map((example) => ({
      ...example,
      currency: rate.unitPrice.currency,
      asOf: today,
      priceBooks: [{ id: book.id, version: book.version }],
      lines: resolvePricingScenarioLines(
        example.lines.map((line) => ({
          ...line,
          bookId: book.id,
          rateId: rate.id,
        })),
        [book],
      ),
      createdAt: `${today}T00:00:00.000Z`,
      updatedAt: `${today}T00:00:00.000Z`,
    }));
  } catch {
    // A fixture this cannot price, such as a minimum above the examples.
    return [];
  }
}
