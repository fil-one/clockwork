import type * as CommerceClient from "@/src/features/contracts/commerce-client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { exportPriceBookExchange } from "@clockwork/domain/core";
import { MoneySchema } from "@clockwork/contracts";
const mocks = vi.hoisted(() => ({ send: vi.fn().mockResolvedValue({}) }));
vi.mock("@/src/features/contracts/commerce-client", async (original) => ({
  ...(await original<typeof CommerceClient>()),
  sendCoreCommand: mocks.send,
}));
import { PriceBookImport } from "./price-book-import";
const document = exportPriceBookExchange(
  {
    id: "66000000-0000-4000-8000-000000000001",
    name: "Uploaded USD",
    version: 7,
    rowVersion: 8,
    currency: "USD",
    rateCards: [
      {
        id: "66100000-0000-4000-8000-000000000001",
        sku: "STORAGE",
        region: "us-east-2",
        unit: "TB-month",
        approvedClaim: "Storage",
        unitPrice: MoneySchema.parse({
          currency: "USD",
          minor: "9007199254740993",
        }),
        overageRate: MoneySchema.parse({ currency: "USD", minor: "18000" }),
        minimumQuantity: "0.123456789123456789",
        egressTreatment: "metered",
        commitType: "term_drawdown",
        stripeTaxCode: "storage",
        qboIncomeAccount: "4000",
        partnerTransferPrices: {},
      },
    ],
  },
  "2026-09-06T12:00:00.000Z",
);
beforeEach(() => {
  vi.clearAllMocks();
});
it("requires a current validated preview and preserves exact money in submission", async () => {
  const user = userEvent.setup();
  const imported = vi.fn();
  render(
    <PriceBookImport
      books={[]}
      permitted
      readAt="2026-09-06T12:00:00.000Z"
      onBusy={vi.fn()}
      onImported={imported}
    />,
  );
  await user.click(screen.getByText("Import price-book JSON into a new draft"));
  const json = screen.getByLabelText("Price-book JSON");
  await user.click(json);
  await user.paste(JSON.stringify(document));
  expect(screen.queryByRole("form", { name: "Import price book" })).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Validate import preview" }),
  );
  expect(
    screen.getByRole("table", { name: "Imported rate preview" }),
  ).toHaveTextContent("USD 90071992547409.93");
  await user.type(json, " ");
  expect(screen.queryByRole("form", { name: "Import price book" })).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Validate import preview" }),
  );
  await user.type(
    screen.getByLabelText("Import reason"),
    "Review imported commercial economics",
  );
  await user.click(
    screen.getByRole("button", { name: "Create imported draft" }),
  );
  expect(mocks.send).toHaveBeenCalledWith(
    expect.objectContaining({
      resource: "price_books",
      action: "import",
      payload: {
        name: "Uploaded USD",
        version: 1,
        effectiveFrom: "2026-09-06",
        reason: "Review imported commercial economics",
        document,
      },
    }),
  );
  expect(imported).toHaveBeenCalledOnce();
});
it("rejects injected approval fields before exposing an import command", async () => {
  const user = userEvent.setup();
  render(
    <PriceBookImport
      books={[]}
      permitted
      readAt="2026-09-06T12:00:00.000Z"
      onBusy={vi.fn()}
      onImported={vi.fn()}
    />,
  );
  await user.click(screen.getByText("Import price-book JSON into a new draft"));
  await user.click(screen.getByLabelText("Price-book JSON"));
  await user.paste(
    JSON.stringify({ ...document, approvals: [{ status: "approved" }] }),
  );
  await user.click(
    screen.getByRole("button", { name: "Validate import preview" }),
  );
  expect(
    screen.queryByRole("button", { name: "Create imported draft" }),
  ).toBeNull();
  expect(mocks.send).not.toHaveBeenCalled();
});
