import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PriceBookAdministrationRecord } from "@clockwork/db";

vi.mock("@/src/features/contracts/commerce-client", () => ({
  sendCoreCommand: vi.fn(),
}));

import { indicativePriceBooks } from "./books";
import { PricingWorkspace } from "./pricing-workspace";

const rate = {
  id: "rate-1",
  sku: "storage-tb-month",
  region: "us-east",
  unit: "tb_month",
  unitPrice: { amountMinor: "1000", currency: "USD" },
} as unknown as NonNullable<PriceBookAdministrationRecord["rateCards"]>[number];

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
  it("opens on the active book and leaves out retired, expired and empty ones", () => {
    const books = indicativePriceBooks(
      [
        book({ id: "draft", status: "draft", version: 2 }),
        book({ id: "active" }),
        book({ id: "retired", status: "retired" }),
        book({ id: "ended", effectiveTo: "2026-09-30" }),
        book({ id: "empty", status: "draft", rateCards: [] }),
      ],
      today,
      label,
    );
    expect(books.map(({ id }) => id)).toEqual(["active", "draft"]);
    expect(books[0]?.effectiveLabel).toBe("on 2026-09-01");
  });

  it("hands the browser no review history or approver identity", () => {
    const [first] = indicativePriceBooks([book({})], today, label);
    expect(first).not.toHaveProperty("activationRequestedByEmail");
    expect(first).not.toHaveProperty("lastDecisionReason");
    expect(first).not.toHaveProperty("rowVersion");
  });
});

describe("pricing workspace", () => {
  const books = indicativePriceBooks(
    [
      book({ id: "active", name: "Standard" }),
      book({ id: "draft", name: "Proposed", status: "draft", version: 2 }),
    ],
    today,
    label,
  );

  it("states where the figures come from and switches books", async () => {
    const user = userEvent.setup();
    render(<PricingWorkspace books={books} initialBookId="active" />);
    expect(screen.getByRole("note")).toHaveTextContent(
      "Prices from the active price book, effective on 2026-09-01.",
    );
    await user.selectOptions(
      screen.getByLabelText("Price book"),
      "Proposed, version 2, USD",
    );
    expect(screen.getByRole("note")).toHaveTextContent(
      "a draft price book that finance has not approved yet",
    );
  });

  it("offers the calculator and no way to change a book", () => {
    render(<PricingWorkspace books={books} initialBookId="active" />);
    expect(screen.getAllByRole("button")).toEqual([
      screen.getByRole("button", { name: "Simulate saved pricing" }),
    ]);
  });
});
