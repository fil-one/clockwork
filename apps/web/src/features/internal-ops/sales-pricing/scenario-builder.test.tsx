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

it("says plainly when scenarios are unavailable, as in the demo", () => {
  render(<ScenarioBuilder books={books} state={{ kind: "unavailable" }} />);
  expect(
    screen.getByText(
      "Saved scenarios are not available here. The calculator above still works.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button")).toBeNull();
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
  expect(within(status).getByText("$21,000.00")).toBeInTheDocument();
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
    createdAt: summary.updatedAt,
  };
  render(<ScenarioBuilder books={books} state={ready(opened)} />);
  expect(
    screen.getByRole("heading", { name: "Editing Pilot" }),
  ).toBeInTheDocument();
  const second = screen.getByRole("group", { name: "Line 2" });
  expect(
    within(second).getByText(
      "The saved rate STORAGE-TB, us-east is no longer in force. Choose a current rate before you save.",
    ),
  ).toBeInTheDocument();
  expect(within(second).getByLabelText("Storage option")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(
    within(screen.getByRole("group", { name: "Line 1" })).getByLabelText(
      "Discount (%)",
    ),
  ).toHaveValue(12.5);
  await user.selectOptions(
    within(second).getByLabelText("Storage option"),
    archive,
  );
  // Saved at 12.25 x 500 x 12 twice; today 13.13 and 3.50 for the same entry.
  const status = screen.getByRole("status");
  expect(within(status).getByText("$99,780.00")).toBeInTheDocument();
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
  const quantity = screen.getByLabelText("Quantity (TB-month)");
  await user.clear(quantity);
  await user.type(quantity, "5");
  expect(
    screen.getByText(
      "This is below the minimum of 10 TB-month. A quote starts at the minimum.",
    ),
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
