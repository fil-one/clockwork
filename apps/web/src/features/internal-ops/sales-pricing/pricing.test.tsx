import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { PriceBookAdministrationRecord } from "@clockwork/db";

import { indicativePriceBooks, type IndicativePriceBook } from "./books";
import { PricingWorkspace } from "./pricing-workspace";

type RateCard = NonNullable<PriceBookAdministrationRecord["rateCards"]>[number];

const usd = (minor: string) => ({ currency: "USD", minor }) as never;

const rate = {
  id: "rate-1",
  sku: "STORAGE-TB",
  region: "us-east",
  unit: "TB-month",
  approvedClaim: "approved storage claim",
  unitPrice: usd("1500"),
  floorPrice: usd("1111"),
  overageRate: usd("1800"),
  minimumQuantity: "10",
  trialLimit: "1",
  egressTreatment: "included",
  commitType: "period_allowance",
  stripeTaxCode: "txcd_secret_code",
  qboIncomeAccount: "qbo-income-4000",
  partnerTransferPrices: { gold: usd("977") },
} as unknown as RateCard;

function book(
  overrides: Partial<PriceBookAdministrationRecord>,
): PriceBookAdministrationRecord {
  return {
    id: "book",
    name: "Standard",
    currency: "USD",
    version: 1,
    rowVersion: 3,
    status: "active",
    effectiveFrom: "2026-09-01",
    effectiveTo: null,
    rateCardCount: 1,
    rateCards: [rate],
    discountMatrix: {
      id: "matrix",
      version: 1,
      defaultMaxDiscountBps: 1234,
      rules: [{ id: "rule", maxDiscountBps: 2345, partnerTier: "gold" }],
    },
    regions: ["us-east"],
    activationRequestedBy: "finance-user",
    activationRequestedByEmail: "finance@fil.one",
    activationRequestedAt: "2026-08-30T00:00:00.000Z",
    lastDecisionAt: null,
    lastDecisionReason: "Internal approval note",
    ...overrides,
  };
}

const today = "2026-10-04";
const label = (iso: string) => `on ${iso}`;

describe("indicative price books", () => {
  it("offers active books in force only, US dollars first", () => {
    const books = indicativePriceBooks(
      [
        book({ id: "eur", currency: "EUR" }),
        book({ id: "draft", status: "draft", version: 2 }),
        book({ id: "active" }),
        book({ id: "retired", status: "retired" }),
        book({ id: "ended", effectiveTo: "2026-09-30" }),
        book({ id: "future", effectiveFrom: "2026-11-01" }),
        book({ id: "empty", rateCards: [] }),
      ],
      today,
      label,
    );
    expect(books.map(({ id }) => id)).toEqual(["active", "eur"]);
    expect(books[0]?.effectiveLabel).toBe("on 2026-09-01");
  });

  it("hands the browser list prices and nothing behind them", () => {
    const serialized = JSON.stringify(
      indicativePriceBooks([book({})], today, label),
    );
    for (const secret of [
      "floorPrice",
      "1111",
      "partnerTransferPrices",
      "gold",
      "977",
      "stripeTaxCode",
      "txcd_secret_code",
      "qboIncomeAccount",
      "qbo-income-4000",
      "approvedClaim",
      "discountMatrix",
      "1234",
      "2345",
      "trialLimit",
      "egressTreatment",
      "activationRequestedByEmail",
      "finance@fil.one",
      "lastDecisionReason",
      "rowVersion",
    ])
      expect(serialized).not.toContain(secret);
    const [first] = JSON.parse(serialized) as IndicativePriceBook[];
    expect(first?.rates[0]).toEqual({
      id: "rate-1",
      sku: "STORAGE-TB",
      region: "us-east",
      unit: "TB-month",
      unitPrice: { currency: "USD", minor: "1500" },
      overageRate: { currency: "USD", minor: "1800" },
      minimumQuantity: "10",
      commitType: "period_allowance",
    });
  });
});

describe("pricing workspace", () => {
  const books = indicativePriceBooks(
    [
      book({ id: "active", name: "Standard" }),
      book({ id: "eur", name: "Europe", currency: "EUR" }),
    ],
    today,
    label,
  );

  it("prices a monthly figure and a total from the list price", async () => {
    const user = userEvent.setup();
    render(<PricingWorkspace books={books} initialBookId="active" />);
    expect(screen.getByRole("note")).toHaveTextContent(
      "Prices from the active price book, effective on 2026-09-01.",
    );
    const quantity = screen.getByLabelText("Quantity (TB-month)");
    await user.clear(quantity);
    await user.type(quantity, "500");
    await user.click(
      screen.getByRole("button", { name: "Work out the price" }),
    );
    const result = screen.getByRole("status");
    expect(within(result).getByText("$7,500.00")).toBeInTheDocument();
    expect(within(result).getByText("$90,000.00")).toBeInTheDocument();
    expect(result).toHaveTextContent("Indicative only.");
  });

  it("says when a quantity is below the minimum", async () => {
    const user = userEvent.setup();
    render(<PricingWorkspace books={books} initialBookId="active" />);
    const quantity = screen.getByLabelText("Quantity (TB-month)");
    await user.clear(quantity);
    await user.type(quantity, "2");
    await user.click(
      screen.getByRole("button", { name: "Work out the price" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "This is below the minimum of 10 TB-month.",
    );
  });

  it("offers no partner route, partner tier or book changes", () => {
    render(<PricingWorkspace books={books} initialBookId="active" />);
    expect(screen.queryByLabelText(/route|tier/iu)).toBeNull();
    expect(screen.getAllByRole("button")).toEqual([
      screen.getByRole("button", { name: "Work out the price" }),
    ]);
  });
});
