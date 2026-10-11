import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type {
  PricingScenarioRecord,
  PricingScenarioSummary,
} from "@clockwork/contracts";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("./scenario-actions", () => ({
  saveScenario: mocks.save,
  deleteScenario: mocks.remove,
}));
import type { IndicativePriceBook } from "./books";
import { ScenarioBuilder } from "./scenario-builder";

const bookId = "60000000-0000-4000-8000-000000000001";
const storage = "61000000-0000-4000-8000-000000000001";
const archive = "61000000-0000-4000-8000-000000000002";
const books: IndicativePriceBook[] = [
  {
    id: bookId,
    name: "Standard",
    version: 3,
    currency: "USD",
    effectiveLabel: "September 1, 2026",
    rates: [
      {
        id: storage,
        sku: "STORAGE-TB",
        region: "us-east",
        unit: "TB-month",
        unitPrice: { currency: "USD", minor: "1500" },
        overageRate: { currency: "USD", minor: "1800" },
        minimumQuantity: "10",
        commitType: "period_allowance",
      },
      {
        id: archive,
        sku: "ARCHIVE-TB",
        region: "us-east",
        unit: "TB-month",
        unitPrice: { currency: "USD", minor: "400" },
        overageRate: { currency: "USD", minor: "500" },
        minimumQuantity: "10",
        commitType: "period_allowance",
      },
    ],
  },
];
const summary: PricingScenarioSummary = {
  id: "019a44ac-0000-7000-8000-00000000ab01",
  ownerId: "019a44ac-0000-7000-8000-00000000ab02",
  ownerName: "Seller",
  name: "Pilot",
  company: "Acme",
  currency: "USD",
  asOf: "2026-10-10",
  updatedAt: "2026-10-10T12:00:00.000Z",
  version: 2,
  lineCount: 1,
  total: { currency: "USD", minor: "8100000" } as never,
};
const ready = (opened: PricingScenarioRecord | null = null) =>
  ({ kind: "ready", scenarios: [summary], opened, seesAll: false }) as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({
    ok: true,
    value: { id: summary.id, version: 1 },
  });
  mocks.remove.mockResolvedValue({ ok: true, value: { id: summary.id } });
});

it("keeps the calculator and says plainly when scenarios are unavailable", () => {
  render(<ScenarioBuilder books={books} state={{ kind: "unavailable" }} />);
  expect(
    screen.getByText(
      "Saving scenarios is not available here. The calculator still works.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Line 1" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Term total$18,000.00");
  expect(screen.queryByRole("button", { name: "Save as scenario" })).toBeNull();
  expect(screen.queryByLabelText("Scenario name")).toBeNull();
  expect(screen.queryByRole("region", { name: "My scenarios" })).toBeNull();
});

it("puts the save and the summary PDF under the total", async () => {
  const user = userEvent.setup();
  render(<ScenarioBuilder books={books} state={ready()} />);
  const download = screen.getByRole("button", {
    name: "Download summary PDF",
  });
  expect(download).toBeDisabled();
  expect(download).toHaveAccessibleDescription(
    "Save the scenario to download its summary PDF.",
  );
  await user.type(screen.getByLabelText("Scenario name"), "Pilot");
  await user.type(screen.getByLabelText("Prospect or company"), "Acme");
  await user.click(screen.getByRole("button", { name: "Save as scenario" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
});

it("prices several lines and saves only the entry, never a price", async () => {
  const user = userEvent.setup();
  render(<ScenarioBuilder books={books} state={ready()} />);
  await user.type(screen.getByLabelText("Scenario name"), "Pilot");
  await user.type(screen.getByLabelText("Prospect or company"), "Acme, Inc.");
  await user.click(screen.getByRole("button", { name: "Add line" }));
  const second = screen.getByRole("group", { name: "Line 2" });
  await user.selectOptions(
    within(second).getByLabelText("Storage option"),
    archive,
  );
  const discount = within(
    screen.getByRole("group", { name: "Line 1" }),
  ).getByLabelText("Discount (%)");
  await user.clear(discount);
  await user.type(discount, "10");
  // 13.50 x 100 x 12 + 4.00 x 100 x 12 = 21,000.00 of 22,800.00 at list.
  const status = screen.getByRole("status");
  expect(within(status).getByText("$22,800.00")).toBeInTheDocument();
  expect(within(status).getByText("$1,800.00")).toBeInTheDocument();
  // 1,350.00 + 400.00 a month; twelve months is the term.
  expect(within(status).getByText("$1,750.00")).toBeInTheDocument();
  expect(within(status).getAllByText("$21,000.00")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Save as scenario" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  const [payload] = mocks.save.mock.calls[0] as [Record<string, unknown>];
  expect(payload).toMatchObject({
    name: "Pilot",
    company: "Acme, Inc.",
    lines: [
      {
        bookId,
        rateId: storage,
        quantity: "100",
        termMonths: 12,
        discountBps: 1000,
      },
      { bookId, rateId: archive, quantity: "100", termMonths: 12 },
    ],
  });
  expect(payload).not.toHaveProperty("expectedVersion");
  expect(JSON.stringify(payload)).not.toMatch(/unitPrice|minor|1500/);
  expect(mocks.push).toHaveBeenCalledWith(
    `/internal/pricing?scenario=${summary.id}`,
  );
});

it("opens a saved scenario to overwrite it and flags a rate that left force", async () => {
  const user = userEvent.setup();
  const line = {
    bookId,
    bookVersion: 2,
    rateId: storage,
    sku: "STORAGE-TB",
    region: "us-east",
    unit: "TB-month",
    unitPrice: { currency: "USD", minor: "1400" },
    minimumQuantity: "10",
    quantity: "500",
    termMonths: 12,
    discountBps: 1250,
  } as PricingScenarioRecord["lines"][number];
  const opened: PricingScenarioRecord = {
    ...summary,
    notes: "",
    priceBooks: [{ id: bookId, version: 2 }],
    lines: [line, { ...line, rateId: "61000000-0000-4000-8000-0000000000ff" }],
    partnerEconomics: null,
    createdAt: summary.updatedAt,
  };
  render(<ScenarioBuilder books={books} state={ready(opened)} />);
  expect(
    screen.getByRole("heading", { name: "Editing Pilot" }),
  ).toBeInTheDocument();
  const second = screen.getByRole("group", { name: "Line 2" });
  expect(
    within(second).getByText(
      "The saved rate Storage, us-east is no longer in force. Choose a current rate before you save.",
    ),
  ).toBeInTheDocument();
  expect(within(second).getByLabelText("Storage option")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(
    within(screen.getByRole("group", { name: "Line 1" })).getByLabelText(
      "Discount (%)",
    ),
  ).toHaveValue(12.5);
  // The PDF is the saved scenario: offered while the form matches it.
  expect(
    screen.getByRole("link", { name: "Download summary PDF" }),
  ).toHaveAttribute(
    "href",
    `/internal/pricing/scenarios/${summary.id}/summary`,
  );
  await user.selectOptions(
    within(second).getByLabelText("Storage option"),
    archive,
  );
  expect(
    screen.getByRole("button", { name: "Download summary PDF" }),
  ).toHaveAccessibleDescription(
    "The summary PDF shows the scenario as last saved. Save your changes to update it.",
  );
  // Saved at 12.25 x 500 x 12 twice; today 13.13 and 3.50 for the same entry.
  const status = screen.getByRole("status");
  expect(within(status).getAllByText("$99,780.00")).toHaveLength(2);
  expect(within(status).getByText("Total when saved")).toBeInTheDocument();
  expect(within(status).getByText("$147,000.00")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: summary.id, expectedVersion: 2 }),
    ),
  );
});

it("warns about a quantity below the minimum and will not save it", async () => {
  const user = userEvent.setup();
  render(<ScenarioBuilder books={books} state={ready()} />);
  await user.type(screen.getByLabelText("Scenario name"), "Pilot");
  await user.type(screen.getByLabelText("Prospect or company"), "Acme");
  const quantity = screen.getByLabelText("Capacity (TB)");
  await user.clear(quantity);
  await user.type(quantity, "5");
  expect(
    screen.getByText("Enter at least 10 TB. A quote starts at the minimum."),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Save as scenario" }),
  ).toBeDisabled();
});

it("words a company the summary cannot print against the field", async () => {
  const user = userEvent.setup();
  mocks.save.mockResolvedValue({
    ok: false,
    code: "INVALID_INPUT",
    fields: { company: "unprintable" },
  });
  render(<ScenarioBuilder books={books} state={ready()} />);
  await user.type(screen.getByLabelText("Scenario name"), "Pilot");
  await user.type(screen.getByLabelText("Prospect or company"), "株式会社");
  await user.click(screen.getByRole("button", { name: "Save as scenario" }));
  expect(
    await screen.findByText(
      "The summary can print Latin letters only. Enter the company name in Latin letters.",
    ),
  ).toBeInTheDocument();
});

it("lists scenarios to open, download and delete", async () => {
  const user = userEvent.setup();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<ScenarioBuilder books={books} state={ready()} />);
  const list = screen.getByRole("region", { name: "My scenarios" });
  expect(within(list).getByText("Pilot")).toBeInTheDocument();
  expect(
    within(list).getByRole("link", { name: "Open Pilot" }),
  ).toHaveAttribute("href", `/internal/pricing?scenario=${summary.id}`);
  expect(
    within(list).getByRole("link", {
      name: "Download the indicative summary for Pilot",
    }),
  ).toHaveAttribute(
    "href",
    `/internal/pricing/scenarios/${summary.id}/summary`,
  );
  await user.click(within(list).getByRole("button", { name: "Delete Pilot" }));
  expect(mocks.remove).toHaveBeenCalledWith({
    id: summary.id,
    expectedVersion: 2,
  });
  expect(await screen.findByText("Deleted Pilot.")).toBeInTheDocument();
});

it("takes capacity in PiB, shows it in TB and sends the entry as typed", async () => {
  const user = userEvent.setup();
  render(<ScenarioBuilder books={books} state={ready()} />);
  const line = screen.getByRole("group", { name: "Line 1" });
  await user.selectOptions(within(line).getByLabelText("Unit"), "PiB");
  const capacity = within(line).getByLabelText("Capacity (PiB)");
  await user.clear(capacity);
  await user.type(capacity, "10");
  expect(capacity).toHaveAccessibleDescription(
    expect.stringContaining("10 PiB ≈ 11,259 TB"),
  );
  // 11,258.99906842624 TB x 15.00 = 168,884.99 a month.
  expect(within(line).getByText("$168,884.99")).toBeInTheDocument();
  await user.selectOptions(within(line).getByLabelText("Unit"), "PB");
  expect(capacity).toHaveAccessibleDescription(
    expect.stringContaining("10 PB = 10,000 TB"),
  );
  await user.type(screen.getByLabelText("Scenario name"), "Regional");
  await user.type(screen.getByLabelText("Prospect or company"), "Acme");
  await user.click(screen.getByRole("button", { name: "Save as scenario" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  expect(mocks.save.mock.calls[0]?.[0]).toMatchObject({
    lines: [{ quantity: "10", quantityUnit: "PB" }],
    partnerEconomics: null,
  });
});

it("derives a resale buy price from the margin and saves the partner inputs", async () => {
  const user = userEvent.setup();
  render(<ScenarioBuilder books={books} state={ready()} />);
  const panel = screen.getByRole("group", { name: "Partner economics" });
  await user.selectOptions(
    within(panel).getByLabelText("Partner model"),
    "resale",
  );
  await user.type(
    within(panel).getByLabelText(
      "Partner's price to its customer, per TB-month",
    ),
    "6.50",
  );
  await user.type(within(panel).getByLabelText("Partner margin (%)"), "32");
  expect(
    within(panel).getByLabelText("Partner margin (%)"),
  ).toHaveAccessibleDescription(
    "Fil One's price to the partner: $4.42 per TB-month.",
  );
  const figures = within(panel).getByRole("table", { name: "Partner figures" });
  // 100 TB: the partner keeps 2.08 a TB, 208.00 a month.
  expect(
    within(
      within(figures).getByRole("row", { name: /Partner earns/u }),
    ).getByText("$208.00"),
  ).toBeInTheDocument();
  expect(
    within(
      within(figures).getByRole("row", { name: /Fil One net revenue/u }),
    ).getByText("$442.00"),
  ).toBeInTheDocument();
  await user.selectOptions(
    within(panel).getByLabelText("Work out from"),
    "buyPrice",
  );
  await user.type(
    within(panel).getByLabelText(
      "Fil One's price to the partner, per TB-month",
    ),
    "4.40",
  );
  expect(
    within(panel).getByLabelText(
      "Fil One's price to the partner, per TB-month",
    ),
  ).toHaveAccessibleDescription("Partner margin: 32.31%.");
  await user.type(screen.getByLabelText("Scenario name"), "Resale");
  await user.type(screen.getByLabelText("Prospect or company"), "Acme");
  await user.click(screen.getByRole("button", { name: "Save as scenario" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  expect(mocks.save.mock.calls[0]?.[0]).toMatchObject({
    partnerEconomics: {
      model: "resale",
      customerPriceMinor: "650",
      buyPriceMinor: "440",
    },
  });
});

it("steps a referral commission down and shows each period", async () => {
  const user = userEvent.setup();
  render(<ScenarioBuilder books={books} state={ready()} />);
  const term = within(
    screen.getByRole("group", { name: "Line 1" }),
  ).getByLabelText("Term (months)");
  await user.clear(term);
  await user.type(term, "36");
  const panel = screen.getByRole("group", { name: "Partner economics" });
  await user.selectOptions(
    within(panel).getByLabelText("Partner model"),
    "referral",
  );
  const commission = within(panel).getByLabelText("Commission (%)");
  await user.clear(commission);
  await user.type(commission, "30");
  await user.click(
    within(panel).getByRole("button", { name: "Add a step-down" }),
  );
  expect(within(panel).getByLabelText("Step 1: from month")).toHaveValue("13");
  await user.type(within(panel).getByLabelText("Step 1: commission (%)"), "20");
  const periods = within(panel).getByRole("table", { name: "By period" });
  // 1,500.00 a month at 30% and then 20%.
  expect(
    within(periods).getByRole("row", { name: /1 to 12/u }),
  ).toHaveTextContent("$450.00");
  expect(
    within(periods).getByRole("row", { name: /13 to 36/u }),
  ).toHaveTextContent("$300.00");
  expect(
    within(panel).getByRole("table", { name: "By year" }),
  ).toHaveTextContent("Year 3");
  const step = within(panel).getByLabelText("Step 1: from month");
  await user.clear(step);
  await user.type(step, "1");
  expect(step).toHaveAccessibleDescription(
    "Enter a month from 2 to 120, later than the step above.",
  );
  await user.clear(step);
  await user.type(step, "13");
  await user.type(screen.getByLabelText("Scenario name"), "Referral");
  await user.type(screen.getByLabelText("Prospect or company"), "Acme");
  await user.click(screen.getByRole("button", { name: "Save as scenario" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  expect(mocks.save.mock.calls[0]?.[0]).toMatchObject({
    partnerEconomics: {
      model: "referral",
      commissionBps: 3000,
      steps: [{ fromMonth: 13, commissionBps: 2000 }],
    },
  });
});

it("offers the partner summary for a saved scenario with partner inputs", () => {
  const opened: PricingScenarioRecord = {
    ...summary,
    notes: "",
    priceBooks: [{ id: bookId, version: 3 }],
    lines: [
      {
        bookId,
        bookVersion: 3,
        rateId: storage,
        sku: "STORAGE-TB",
        region: "us-east",
        unit: "TB-month",
        unitPrice: { currency: "USD", minor: "1500" },
        minimumQuantity: "10",
        quantity: "11258.99906842624",
        entered: { quantity: "10", unit: "PiB" },
        termMonths: 12,
        discountBps: 0,
      } as PricingScenarioRecord["lines"][number],
    ],
    partnerEconomics: { model: "referral", commissionBps: 1500, steps: [] },
    createdAt: summary.updatedAt,
  };
  render(<ScenarioBuilder books={books} state={ready(opened)} />);
  const line = screen.getByRole("group", { name: "Line 1" });
  expect(within(line).getByLabelText("Capacity (PiB)")).toHaveValue("10");
  expect(within(line).getByLabelText("Unit")).toHaveValue("PiB");
  expect(screen.getByLabelText("Partner model")).toHaveValue("referral");
  expect(
    screen.getByRole("link", { name: "Download partner summary PDF" }),
  ).toHaveAttribute(
    "href",
    `/internal/pricing/scenarios/${summary.id}/summary?audience=partner`,
  );
});

it("lists the demo examples to open and download, with no save", () => {
  const example: PricingScenarioRecord = {
    ...summary,
    id: "019a44ac-0000-7000-8000-0000000de001",
    name: "Resale at $6.50, 32% margin",
    company: "Harborlight Media",
    notes: "",
    priceBooks: [{ id: bookId, version: 3 }],
    lines: [
      {
        bookId,
        bookVersion: 3,
        rateId: storage,
        sku: "STORAGE-TB",
        region: "us-east",
        unit: "TB-month",
        unitPrice: { currency: "USD", minor: "1500" },
        minimumQuantity: "10",
        quantity: "500",
        termMonths: 36,
        discountBps: 0,
      } as PricingScenarioRecord["lines"][number],
    ],
    partnerEconomics: {
      model: "resale",
      customerPriceMinor: "650",
      marginBps: 3200,
    },
    createdAt: summary.updatedAt,
  };
  render(
    <ScenarioBuilder
      books={books}
      state={{ kind: "demo", examples: [example], opened: example }}
    />,
  );
  const list = screen.getByRole("region", { name: "Example scenarios" });
  expect(
    within(list).getByRole("link", {
      name: "Open Resale at $6.50, 32% margin",
    }),
  ).toHaveAttribute("href", `/internal/pricing?scenario=${example.id}`);
  expect(
    within(list).getByRole("link", {
      name: "Download the partner summary for Resale at $6.50, 32% margin",
    }),
  ).toHaveAttribute(
    "href",
    `/internal/pricing/scenarios/${example.id}/summary?audience=partner`,
  );
  expect(screen.getByLabelText("Partner model")).toHaveValue("resale");
  expect(screen.queryByRole("button", { name: "Save as scenario" })).toBeNull();
});

it("reads amounts strictly, refuses a buy price above the customer price and names what blocks a save", async () => {
  const user = userEvent.setup();
  render(<ScenarioBuilder books={books} state={ready()} />);
  const panel = screen.getByRole("group", { name: "Partner economics" });
  await user.selectOptions(
    within(panel).getByLabelText("Partner model"),
    "resale",
  );
  const price = within(panel).getByLabelText(
    "Partner's price to its customer, per TB-month",
  );
  // A decimal comma is not read as a thousands separator.
  await user.type(price, "6,50");
  expect(price).toHaveAccessibleDescription(
    "Enter an amount up to 99,999,999.99, for example 6.50, with no currency sign.",
  );
  // Nothing typed yet, so the margin is not flagged until a save.
  expect(
    within(panel).getByLabelText("Partner margin (%)"),
  ).not.toHaveAttribute("aria-invalid");
  await user.type(screen.getByLabelText("Scenario name"), "Resale");
  await user.type(screen.getByLabelText("Prospect or company"), "Acme");
  await user.click(screen.getByRole("button", { name: "Save as scenario" }));
  expect(mocks.save).not.toHaveBeenCalled();
  expect(
    screen.getByText(
      "Complete the partner inputs, or choose Direct, before you save.",
    ),
  ).toBeInTheDocument();
  expect(within(panel).getByLabelText("Partner margin (%)")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await user.clear(price);
  await user.type(price, "5.00");
  await user.selectOptions(
    within(panel).getByLabelText("Work out from"),
    "buyPrice",
  );
  await user.type(
    within(panel).getByLabelText(
      "Fil One's price to the partner, per TB-month",
    ),
    "5.99",
  );
  // A buy price above the partner's own price is refused, not shown as a loss.
  expect(
    within(panel).getByLabelText(
      "Fil One's price to the partner, per TB-month",
    ),
  ).toHaveAccessibleDescription(
    "Enter a price to the partner no higher than the partner's own price to its customer.",
  );
});

it("says a resale scenario's summary is the partner's quote", () => {
  const opened: PricingScenarioRecord = {
    ...summary,
    notes: "",
    priceBooks: [{ id: bookId, version: 3 }],
    lines: [
      {
        bookId,
        bookVersion: 3,
        rateId: storage,
        sku: "STORAGE-TB",
        region: "us-east",
        unit: "TB-month",
        unitPrice: { currency: "USD", minor: "1500" },
        minimumQuantity: "10",
        quantity: "100",
        termMonths: 12,
        discountBps: 0,
      } as PricingScenarioRecord["lines"][number],
    ],
    partnerEconomics: {
      model: "resale",
      customerPriceMinor: "650",
      marginBps: 3200,
    },
    createdAt: summary.updatedAt,
  };
  render(<ScenarioBuilder books={books} state={ready(opened)} />);
  expect(
    screen.getByText(
      /^On a resale, the summary is the partner's quote to its customer/u,
    ),
  ).toBeInTheDocument();
});

it("ignores line discounts on a resale and refuses partner earnings above spend", async () => {
  const user = userEvent.setup();
  render(<ScenarioBuilder books={books} state={ready()} />);
  const panel = screen.getByRole("group", { name: "Partner economics" });
  await user.selectOptions(
    within(panel).getByLabelText("Partner model"),
    "resale",
  );
  expect(
    within(screen.getByRole("group", { name: "Line 1" })).getByLabelText(
      "Discount (%)",
    ),
  ).toHaveAccessibleDescription(
    "Ignored on a resale: the summaries use the partner's price.",
  );
  expect(
    within(panel).getByText(
      /^On a resale, both summaries price every line at the partner's price/u,
    ),
  ).toBeInTheDocument();
  await user.selectOptions(
    within(panel).getByLabelText("Partner model"),
    "other",
  );
  // 100 TB at 15.00 is 1,500.00 a month; a 2,000.00 fixed amount is more.
  const monthly = within(panel).getByLabelText("Fixed amount per month");
  await user.clear(monthly);
  await user.type(monthly, "2000");
  expect(
    within(panel).getByLabelText("Share of what the customer pays (%)"),
  ).toHaveAccessibleDescription(
    "The partner would earn more than the customer pays. Lower the share, fee or fixed amount.",
  );
  await user.type(screen.getByLabelText("Scenario name"), "Other");
  await user.type(screen.getByLabelText("Prospect or company"), "Acme");
  await user.click(screen.getByRole("button", { name: "Save as scenario" }));
  expect(mocks.save).not.toHaveBeenCalled();
  expect(
    screen.getByText(
      /^The partner would earn more than the customer pays in some month/u,
    ),
  ).toBeInTheDocument();
});

it("offers no customer summary for a resale whose lines differ in unit", () => {
  const line = {
    bookId,
    bookVersion: 3,
    rateId: storage,
    sku: "STORAGE-TB",
    region: "us-east",
    unit: "TB-month",
    unitPrice: { currency: "USD", minor: "1500" },
    minimumQuantity: "10",
    quantity: "100",
    termMonths: 12,
    discountBps: 0,
  } as PricingScenarioRecord["lines"][number];
  const opened: PricingScenarioRecord = {
    ...summary,
    notes: "",
    priceBooks: [{ id: bookId, version: 3 }],
    lines: [line, { ...line, unit: "GB-month" }],
    partnerEconomics: {
      model: "resale",
      customerPriceMinor: "650",
      marginBps: 3200,
    },
    createdAt: summary.updatedAt,
  };
  render(<ScenarioBuilder books={books} state={ready(opened)} />);
  expect(
    screen.getByRole("button", { name: "Download summary PDF" }),
  ).toHaveAccessibleDescription(
    "The customer summary for a resale needs every line in the same unit.",
  );
  expect(
    screen.queryByRole("link", { name: "Download summary PDF" }),
  ).toBeNull();
});
