import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PriceBookAdministrationRecord } from "@clockwork/db";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("./scenario-actions", () => ({
  saveScenario: vi.fn(),
  deleteScenario: vi.fn(),
}));

import { translatorFor } from "@/src/i18n/catalogs";
import { indicativePriceBooks, type IndicativePriceBook } from "./books";
import {
  bookLabel,
  capacityUnit,
  productName,
  regionName,
} from "./presentation";
import { ScenarioBuilder } from "./scenario-builder";

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

const demoState = { kind: "demo", examples: [], opened: null } as const;

describe("pricing builder, line 1 as the calculator", () => {
  const books = indicativePriceBooks(
    [
      book({ id: "active", name: "Standard" }),
      book({ id: "eur", name: "Europe", currency: "EUR" }),
    ],
    today,
    label,
  );
  const line = () => screen.getByRole("group", { name: "Line 1" });

  it("prices a monthly figure and a total from the list price", async () => {
    const user = userEvent.setup();
    render(<ScenarioBuilder books={books} state={demoState} />);
    expect(screen.getByRole("note")).toHaveTextContent(
      "Prices from the active price book, effective on 2026-09-01.",
    );
    const capacity = within(line()).getByLabelText("Capacity (TB)");
    await user.clear(capacity);
    await user.type(capacity, "500");
    expect(within(line()).getByText("$7,500.00")).toBeInTheDocument();
    // A 12-month term: the year and the term are the same figure.
    expect(within(line()).getAllByText("$90,000.00")).toHaveLength(2);
    expect(
      within(line()).getByText("Price per TB per month"),
    ).toBeInTheDocument();
    expect(
      within(line()).getByText("$18.00 per TB per month"),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Per month$7,500.00Year 1$90,000.00",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Term total$90,000.00",
    );
    expect(screen.getByText(/^Indicative only\./u)).toBeInTheDocument();
  });

  it("names the book, product and region in words", () => {
    render(<ScenarioBuilder books={books} state={demoState} />);
    expect(
      within(line()).getByRole("option", {
        name: "Standard (USD), version 1",
      }),
    ).toBeInTheDocument();
    expect(
      within(line()).getByRole("option", {
        name: "Storage, us-east: $15.00 per TB per month",
      }),
    ).toBeInTheDocument();
  });

  it("marks a capacity below the minimum on the field", async () => {
    const user = userEvent.setup();
    render(<ScenarioBuilder books={books} state={demoState} />);
    const capacity = within(line()).getByLabelText("Capacity (TB)");
    await user.clear(capacity);
    await user.type(capacity, "2");
    expect(capacity).toHaveAttribute("aria-invalid", "true");
    expect(capacity).toHaveAccessibleDescription(
      expect.stringContaining(
        "Enter at least 10 TB. A quote starts at the minimum.",
      ),
    );
  });

  it("says against each field what to enter", async () => {
    const user = userEvent.setup();
    render(<ScenarioBuilder books={books} state={demoState} />);
    const capacity = within(line()).getByLabelText("Capacity (TB)");
    const term = within(line()).getByLabelText("Term (months)");
    const discount = within(line()).getByLabelText("Discount (%)");
    for (const field of [capacity, term, discount])
      expect(field).not.toHaveAttribute("aria-invalid");
    await user.clear(capacity);
    await user.type(capacity, "0");
    await user.clear(term);
    await user.type(term, "130");
    await user.clear(discount);
    await user.type(discount, "150");
    for (const field of [capacity, term, discount])
      expect(field).toHaveAttribute("aria-invalid", "true");
    expect(capacity).toHaveAccessibleDescription(
      expect.stringContaining(
        "Enter the capacity as a number above zero, for example 100.",
      ),
    );
    expect(term).toHaveAccessibleDescription(
      "Enter whole months from 1 to 120, for example 12.",
    );
    expect(discount).toHaveAccessibleDescription(
      expect.stringContaining(
        "Enter a discount from 0 to 100, with up to two decimals.",
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Complete every line to see a total.",
    );
  });

  it("offers no partner route, tier or save in the demo", () => {
    render(<ScenarioBuilder books={books} state={demoState} />);
    expect(screen.queryByLabelText(/route|tier/iu)).toBeNull();
    expect(screen.getAllByRole("button")).toEqual([
      screen.getByRole("button", { name: "Add line" }),
    ]);
    expect(
      screen.getByText("Saving scenarios is turned off in the demo."),
    ).toBeInTheDocument();
  });
});

describe("pricing presentation", () => {
  const t = translatorFor("en");

  it("words SKUs and regions, and leaves unknown codes as they are", () => {
    expect(productName("LOCKED-STORAGE-TB", t)).toBe("Locked storage");
    expect(productName("NEW-SKU", t)).toBe("NEW-SKU");
    expect(regionName("us-east-2", t)).toBe("US East (Ohio)");
    expect(regionName("ap-south-9", t)).toBe("ap-south-9");
    expect(capacityUnit("TB-month")).toBe("TB");
  });

  it("says a book's currency once", () => {
    const [first] = indicativePriceBooks(
      [book({ name: "Direct commerce USD", version: 2 })],
      today,
      label,
    );
    expect(bookLabel(first as IndicativePriceBook, t)).toBe(
      "Direct commerce (USD), version 2",
    );
  });
});
