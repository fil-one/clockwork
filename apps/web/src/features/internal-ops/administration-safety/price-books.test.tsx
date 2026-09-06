import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MoneySchema } from "@clockwork/contracts";
import type { PriceBookAdministrationRecord } from "@clockwork/db";
import type * as CommerceClient from "@/src/features/contracts/commerce-client";

type CommandInput = CommerceClient.CoreCommandInput;

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  sendCoreCommand: vi.fn<(input: CommandInput) => Promise<unknown>>(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/src/features/contracts/commerce-client", async (importOriginal) => {
  const original = await importOriginal<typeof CommerceClient>();
  return { ...original, sendCoreCommand: mocks.sendCoreCommand };
});

import { PriceBookAdministration } from "./price-books";

const draft: PriceBookAdministrationRecord = {
  id: "66000000-0000-4000-8000-000000000003",
  name: "Direct commerce USD",
  currency: "USD",
  version: 3,
  rowVersion: 2,
  status: "draft",
  effectiveFrom: "2026-07-01",
  effectiveTo: null,
  rateCardCount: 1,
  regions: ["us-east-2"],
  activationRequestedBy: "21000000-0000-4000-8000-000000000010",
  activationRequestedByEmail: "commercial.policy@filone.test",
  activationRequestedAt: "2026-07-30T14:00:00.000Z",
  lastDecisionAt: "2026-07-30T14:00:00.000Z",
  lastDecisionReason: "Commercial review completed.",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendCoreCommand.mockResolvedValue({});
});

describe("price-book administration actionability", () => {
  it("distinguishes an available empty catalogue from an outage", () => {
    const { rerender } = render(
      <PriceBookAdministration
        roles={["finance_approver"]}
        userId="21000000-0000-4000-8000-000000000008"
        books={[]}
        source="Pricing service"
        availability="empty"
        readAt="2026-08-18T12:00:00.000Z"
      />,
    );
    expect(screen.getByText("Empty")).toBeVisible();
    expect(
      screen.getByText(/pricing service is available, but no price books/i),
    ).toBeVisible();

    rerender(
      <PriceBookAdministration
        roles={["finance_approver"]}
        userId="21000000-0000-4000-8000-000000000008"
        books={[]}
        source="Pricing service unavailable"
        availability="unavailable"
        readAt="2026-08-18T12:00:00.000Z"
      />,
    );
    expect(screen.getAllByText("Unavailable")).not.toHaveLength(0);
    expect(
      screen.getByText("No price books are readable for this request."),
    ).toBeVisible();
  });

  it("explains that a renamed book still replaces the active currency catalogue", () => {
    render(
      <PriceBookAdministration
        roles={["finance_approver"]}
        userId="reviewer"
        books={[
          { ...draft, name: "New independent book", rateCards: [] },
          {
            ...draft,
            id: "active-other-family",
            status: "active",
            rateCards: [],
          },
        ]}
        source="Pricing service"
        availability="available"
        readAt="2026-09-06T12:00:00.000Z"
      />,
    );
    expect(
      screen.getByText(/Only one price book can be active per currency/),
    ).toBeVisible();
    expect(
      screen.getByRole("table", { name: /Economic changes from/ }),
    ).toBeVisible();
  });

  it("renders a seeded draft as a second-authority finance decision", () => {
    render(
      <PriceBookAdministration
        roles={["finance_approver"]}
        userId="21000000-0000-4000-8000-000000000008"
        books={[draft]}
        source="Deterministic demo fixture"
        availability="available"
        readAt="2026-08-18T12:00:00.000Z"
      />,
    );
    expect(screen.getByText("Direct commerce USD")).toBeVisible();
    expect(screen.getByText(/Guided demo data · Updated/)).toBeVisible();
    expect(screen.queryByText(/Deterministic demo fixture/)).toBeNull();
    expect(
      screen.getByText("Proposed by commercial.policy@filone.test"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Review price-book approval" }),
    ).toBeEnabled();
  });

  it("creates metadata then submits a complete first rate card", async () => {
    const user = userEvent.setup();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "66000000-0000-4000-8000-000000000099",
    );
    render(
      <PriceBookAdministration
        roles={["finance_approver"]}
        userId="21000000-0000-4000-8000-000000000008"
        books={[draft]}
        source="Deterministic demo fixture"
        availability="available"
        readAt="2026-08-18T12:00:00.000Z"
      />,
    );

    const authoring = within(
      screen.getByRole("region", { name: "Author a priced draft" }),
    );
    await user.type(authoring.getByLabelText("Price-book name"), "Demo EUR");
    await user.selectOptions(authoring.getByLabelText("Currency"), "EUR");
    await user.type(authoring.getByLabelText("Version"), "9");
    await user.type(authoring.getByLabelText("Effective from"), "2026-07-01");
    await user.click(
      screen.getByRole("button", { name: "Create draft and continue" }),
    );
    const createInput = mocks.sendCoreCommand.mock.calls[0]?.[0];
    expect(createInput).toMatchObject({
      resource: "price_books",
      action: "create",
      payload: { currency: "EUR", version: 9 },
    });

    expect(await screen.findByLabelText("SKU")).toBeVisible();
    await user.type(screen.getByLabelText("SKU"), "LOCKED-STORAGE-TB");
    await user.type(screen.getByLabelText("Region"), "eu-central-1");
    await user.type(screen.getByLabelText("Unit price · EUR"), "140.00");
    await user.type(screen.getByLabelText("Floor price · EUR"), "95.00");
    await user.type(screen.getByLabelText("Overage rate · EUR"), "170.00");
    await user.type(screen.getByLabelText("Stripe tax code"), "txcd_10103000");
    await user.type(
      screen.getByLabelText("Approved commercial claim"),
      "Fictional immutable storage capacity",
    );
    await user.click(screen.getByRole("button", { name: "Add rate card" }));

    const rateInput = mocks.sendCoreCommand.mock.calls[1]?.[0];
    expect(rateInput).toMatchObject({
      resource: "price_books",
      action: "add_rate",
      expectedVersion: 1,
      payload: {
        sku: "LOCKED-STORAGE-TB",
        unitPrice: { currency: "EUR", minor: "14000" },
      },
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });
});

it("reopens a saved rate and edits transfer economics without losing its other fields", async () => {
  const user = userEvent.setup();
  const money = (minor: string) =>
    MoneySchema.parse({ currency: "USD", minor });
  const editable: PriceBookAdministrationRecord = {
    ...draft,
    activationRequestedBy: null,
    activationRequestedByEmail: null,
    rateCards: [
      {
        id: "66100000-0000-4000-8000-000000000001",
        sku: "STORAGE",
        region: "test-region",
        unit: "TB-month",
        approvedClaim: "Approved storage claim",
        unitPrice: money("500"),
        floorPrice: money("300"),
        overageRate: money("500"),
        minimumQuantity: "1",
        trialLimit: "5",
        egressTreatment: "zero-rated",
        commitType: "term_drawdown",
        stripeTaxCode: "txcd_test",
        qboIncomeAccount: "4000",
        partnerTransferPrices: { gold: money("400") },
      },
    ],
  };
  render(
    <PriceBookAdministration
      roles={["finance_approver"]}
      userId="21000000-0000-4000-8000-000000000008"
      books={[editable]}
      source="Pricing service"
      availability="available"
      readAt="2026-08-18T12:00:00.000Z"
    />,
  );
  Element.prototype.scrollIntoView = vi.fn();
  await user.click(
    screen.getByRole("button", { name: "Edit STORAGE test-region" }),
  );
  expect(screen.getByLabelText("Unit price · USD")).toHaveValue("5.00");
  const transfer = screen.getByLabelText("Transfer price 1 · USD");
  expect(transfer).toHaveValue("4.00");
  await user.clear(transfer);
  await user.type(transfer, "4.25");
  await user.click(screen.getByRole("button", { name: "Save rate card" }));
  expect(mocks.sendCoreCommand.mock.calls[0]?.[0]).toMatchObject({
    action: "update_rate",
    expectedVersion: 2,
    payload: {
      trialLimit: "5",
      partnerTransferPrices: { gold: { currency: "USD", minor: "425" } },
    },
  });
});
