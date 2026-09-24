import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MoneySchema } from "@clockwork/contracts";
import type { PriceBookAdministrationRecord } from "@clockwork/db";
import type * as CommerceClient from "@/src/features/contracts/commerce-client";
import { catalogs } from "@/src/i18n/catalogs";
import { LanguageProvider } from "@/src/i18n/client";
import type { Locale } from "@/src/i18n";

import styles from "./administration-safety.module.css";

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
        source="service"
        availability="empty"
        readAt="2026-08-18T12:00:00.000Z"
      />,
    );
    expect(screen.getByText("No versions")).toBeVisible();
    expect(
      screen.getByText(/pricing service is available, but no price books/i),
    ).toBeVisible();

    rerender(
      <PriceBookAdministration
        roles={["finance_approver"]}
        userId="21000000-0000-4000-8000-000000000008"
        books={[]}
        source="unavailable"
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
        source="service"
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
        source="demo"
        availability="available"
        readAt="2026-08-18T12:00:00.000Z"
      />,
    );
    expect(screen.getByText("Direct commerce USD")).toBeVisible();
    expect(screen.getByText(/Guided demo data · Updated/)).toBeVisible();
    expect(screen.queryByText(/Deterministic demo fixture/)).toBeNull();
    expect(
      screen.getByRole("cell", {
        name: "Proposed by commercial.policy@filone.test",
      }),
    ).toBeVisible();
    // The address sits in its own <bdi>, which is never hyphenated.
    for (const address of screen.getAllByText("commercial.policy@filone.test"))
      expect(address.tagName).toBe("BDI");
    expect(
      screen.getByRole("button", { name: "Review price-book approval" }),
    ).toBeEnabled();
    // A current registry and a held authority are not warnings.
    expect(screen.getByText("Up to date")).toHaveClass(styles.success ?? "");
    for (const pill of screen.getAllByText("Finance authority"))
      expect(pill).toHaveClass(styles.success ?? "");
  });

  it("creates metadata then submits a complete first rate card", async () => {
    const user = userEvent.setup();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "66000000-0000-4000-8000-000000000099",
    );
    const { rerender } = render(
      <PriceBookAdministration
        roles={["finance_approver"]}
        userId="21000000-0000-4000-8000-000000000008"
        books={[draft]}
        source="demo"
        availability="available"
        readAt="2026-08-18T12:00:00.000Z"
      />,
    );

    const authoring = within(
      screen.getByRole("region", { name: "Create a priced draft" }),
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
    await user.type(screen.getByLabelText("Unit price (EUR)"), "140,00");
    await user.type(screen.getByLabelText("Floor price (EUR)"), "95.00");
    await user.type(screen.getByLabelText("Overage rate (EUR)"), "170.00");
    await user.type(screen.getByLabelText("Stripe tax code"), "txcd_10103000");
    await user.type(
      screen.getByLabelText("Approved commercial description"),
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
        // "140,00": a reader who writes a decimal comma is not refused.
        unitPrice: { currency: "EUR", minor: "14000" },
      },
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    const reviewButton = screen.getByRole("button", {
      name: "Review price-book approval",
    });
    expect(reviewButton).toBeDisabled();
    expect(
      screen.getByText("Loading saved price-book changes before review…"),
    ).toBeVisible();
    const emptyBook: PriceBookAdministrationRecord = {
      ...draft,
      id: "66000000-0000-4000-8000-000000000099",
      name: "Demo EUR",
      currency: "EUR",
      version: 9,
      rowVersion: 1,
      rateCardCount: 0,
      regions: [],
      activationRequestedBy: null,
      activationRequestedByEmail: null,
    };
    const page = (book: PriceBookAdministrationRecord) => (
      <PriceBookAdministration
        roles={["finance_approver"]}
        userId="21000000-0000-4000-8000-000000000008"
        books={[draft, book]}
        source="demo"
        availability="available"
        readAt="2026-08-18T12:00:00.000Z"
      />
    );
    // The create refresh can arrive after add_rate succeeds. It must not make
    // that known-obsolete empty version reviewable while the second read waits.
    rerender(page(emptyBook));
    await user.type(
      screen.getByLabelText("Finance decision reason"),
      "Review the saved regional economics.",
    );
    expect(reviewButton).toBeDisabled();
    await user.click(reviewButton);
    expect(
      screen.queryByRole("button", { name: "Propose activation" }),
    ).toBeNull();
    expect(mocks.sendCoreCommand).toHaveBeenCalledTimes(2);
    rerender(
      page({
        ...emptyBook,
        rowVersion: 2,
        rateCardCount: 1,
        regions: ["eu-central-1"],
      }),
    );
    expect(reviewButton).toBeEnabled();
    await user.click(reviewButton);
    const review = within(
      screen.getByRole("region", { name: "Price-book activation review" }),
    );
    expect(review.getByText("1 rate card saved")).toBeVisible();
    expect(review.queryByText("0 rate cards saved")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Propose activation" }),
    );
    expect(mocks.sendCoreCommand.mock.calls[2]?.[0]).toMatchObject({
      id: emptyBook.id,
      action: "request_activation",
      expectedVersion: 2,
      payload: { reason: "Review the saved regional economics." },
    });
    // A successful proposal is also awaiting its server read: don't reopen an
    // editor or submit another review against the pre-proposal draft meanwhile.
    expect(
      screen.getByRole("button", { name: "Review price-book approval" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Add a rate to this draft" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Create draft and continue" }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Refresh saved changes" }),
    );
    expect(mocks.sendCoreCommand).toHaveBeenCalledTimes(3);
    expect(mocks.refresh).toHaveBeenCalledTimes(4);
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
      source="service"
      availability="available"
      readAt="2026-08-18T12:00:00.000Z"
    />,
  );
  Element.prototype.scrollIntoView = vi.fn();
  await user.click(
    screen.getByRole("button", { name: "Edit rate STORAGE in test-region" }),
  );
  expect(screen.getByLabelText("Unit price (USD)")).toHaveValue("5.00");
  const transfer = screen.getByLabelText("Transfer price 1 (USD)");
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

it("invalidates reviewed evidence when a refreshed price-book version arrives", async () => {
  const user = userEvent.setup();
  const unproposed = {
    ...draft,
    activationRequestedBy: null,
    activationRequestedByEmail: null,
  };
  const page = (book: PriceBookAdministrationRecord) => (
    <PriceBookAdministration
      roles={["finance_approver"]}
      userId="21000000-0000-4000-8000-000000000008"
      books={[book]}
      source="service"
      availability="available"
      readAt="2026-09-06T12:00:00.000Z"
    />
  );
  const { rerender } = render(page(unproposed));
  await user.type(
    screen.getByLabelText("Finance decision reason"),
    "Reviewed regional pricing and floors.",
  );
  await user.click(
    screen.getByRole("button", { name: "Review price-book approval" }),
  );
  expect(
    screen.getByRole("button", { name: "Propose activation" }),
  ).toBeEnabled();
  rerender(
    page({
      ...unproposed,
      rowVersion: 3,
      rateCardCount: 2,
      regions: ["us-east-2", "us-west-2"],
    }),
  );
  expect(
    screen.queryByRole("button", { name: "Propose activation" }),
  ).toBeNull();
  expect(
    screen.getByText(
      "The price book changed after your review. Review the current version before recording a decision.",
    ),
  ).toBeVisible();
  expect(mocks.sendCoreCommand).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Review price-book approval" }),
  );
  expect(screen.getByText("2 rate cards saved")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Propose activation" }));
  expect(mocks.sendCoreCommand.mock.calls[0]?.[0]).toMatchObject({
    action: "request_activation",
    expectedVersion: 3,
  });
});

it.each([
  {
    effectiveFrom: "2026-09-07",
    effectiveTo: null,
    allowed: false,
    note: "Activation is available on or after",
  },
  {
    effectiveFrom: "2026-09-01",
    effectiveTo: "2026-09-05",
    allowed: false,
    note: "This draft’s effective period has expired",
  },
  {
    effectiveFrom: "2026-09-01",
    effectiveTo: "2026-09-06",
    allowed: true,
    note: null,
  },
])(
  "keeps date-bound approval truthful: $effectiveFrom to $effectiveTo",
  async ({ effectiveFrom, effectiveTo, allowed, note }) => {
    const user = userEvent.setup();
    render(
      <PriceBookAdministration
        roles={["finance_approver"]}
        userId="other-finance"
        books={[{ ...draft, effectiveFrom, effectiveTo }]}
        source="service"
        availability="available"
        readAt="2026-09-06T23:59:00.000Z"
      />,
    );
    if (note) expect(screen.getByText(new RegExp(note))).toBeVisible();
    await user.type(
      screen.getByLabelText("Finance decision reason"),
      "Review the approved effective window.",
    );
    await user.click(
      screen.getByRole("button", { name: "Review price-book approval" }),
    );
    expect(
      screen.queryByRole("button", { name: "Approve and activate" }) !== null,
    ).toBe(allowed);
    expect(
      screen.queryByRole("button", { name: "Approve scheduled activation" }) !==
        null,
    ).toBe(effectiveFrom > "2026-09-06");
    expect(
      screen.getByRole("button", { name: "Return draft for changes" }),
    ).toBeEnabled();
  },
);

it("shows an approved schedule as frozen and permits explicit cancellation", async () => {
  const user = userEvent.setup();
  render(
    <PriceBookAdministration
      roles={["finance_approver"]}
      userId="reviewer"
      books={[
        {
          ...draft,
          effectiveFrom: "2099-01-01",
          activationSchedule: {
            id: "schedule",
            status: "approved",
            effectiveFrom: "2099-01-01",
            effectiveTo: null,
            approvedAt: "2026-09-06T12:00:00Z",
            completedAt: null,
            completionReason: null,
          },
        },
      ]}
      source="service"
      availability="available"
      readAt="2026-09-06T12:00:00Z"
    />,
  );
  expect(screen.getByText("Activation schedule · Approved")).toBeVisible();
  expect(screen.getByText("Scheduled for Jan 1, 2099")).toBeVisible();
  await user.type(
    screen.getByLabelText("Finance decision reason"),
    "Cancel the future change and request a fresh review.",
  );
  await user.click(
    screen.getByRole("button", { name: "Review price-book approval" }),
  );
  expect(
    screen.getAllByRole("heading", { name: "Schedule cancellation review" })
      .length,
  ).toBeGreaterThan(0);
  expect(
    screen.getByText(
      "Cancels the approved schedule and unlocks this draft for editing. Current active pricing stays in place.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Approve scheduled activation" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Return draft for changes" }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Cancel approved schedule" }),
  );
  expect(mocks.sendCoreCommand).toHaveBeenCalledWith(
    expect.objectContaining({ action: "cancel_schedule", expectedVersion: 2 }),
  );
});

it("reports a duplicate clone version before sending a mutation", async () => {
  const user = userEvent.setup();
  render(
    <PriceBookAdministration
      roles={["finance_approver"]}
      userId="other-finance"
      books={[draft]}
      source="service"
      availability="available"
      readAt="2026-09-06T12:00:00.000Z"
    />,
  );
  await user.click(screen.getByText("Clone this version into a draft"));
  await user.clear(screen.getByLabelText("Cloned price-book version"));
  await user.type(screen.getByLabelText("Cloned price-book version"), "3");
  await user.type(
    screen.getByLabelText("Clone reason"),
    "Prepare next regional pricing version",
  );
  await user.click(screen.getByRole("button", { name: "Create cloned draft" }));
  expect(
    screen.getByText("USD version 3 already exists. Choose a new version."),
  ).toBeVisible();
  expect(mocks.sendCoreCommand).not.toHaveBeenCalled();
});

describe("the page in the reader's language", () => {
  const usd = (minor: string) => MoneySchema.parse({ currency: "USD", minor });
  const rate = {
    id: "66100000-0000-4000-8000-000000000001",
    sku: "LOCKED-STORAGE-TB",
    region: "us-east-2",
    unit: "TB-month",
    approvedClaim: "Capacidade fictícia de armazenamento imutável",
    unitPrice: usd("15000"),
    floorPrice: usd("10000"),
    overageRate: usd("18000"),
    minimumQuantity: "1",
    egressTreatment: "metered",
    commitType: "term_drawdown" as const,
    stripeTaxCode: "txcd_10103000",
    qboIncomeAccount: "4000-Storage",
    partnerTransferPrices: { reseller: usd("12000") },
  };
  const books: PriceBookAdministrationRecord[] = [
    { ...draft, name: "Venda direta USD", rateCards: [rate] },
    {
      ...draft,
      id: "66000000-0000-4000-8000-000000000001",
      name: "Venda direta USD",
      version: 2,
      status: "active",
      activationRequestedBy: null,
      activationRequestedByEmail: null,
      rateCards: [{ ...rate, unitPrice: usd("15500") }],
    },
  ];
  const renderIn = (locale: Locale) =>
    render(
      <LanguageProvider locale={locale} catalog={catalogs[locale]}>
        <PriceBookAdministration
          roles={["finance_approver"]}
          userId="21000000-0000-4000-8000-000000000008"
          books={books}
          source="demo"
          availability="available"
          readAt="2026-08-18T12:00:00.000Z"
        />
      </LanguageProvider>,
    );

  it("writes every label, count, amount and date in Brazilian Portuguese", () => {
    renderIn("pt");
    expect(
      screen.getByRole("heading", { level: 1, name: "Tabelas de preços" }),
    ).toBeVisible();
    expect(
      screen.getByText("Somente versões ativadas definem o preço."),
    ).toBeVisible();
    expect(
      screen.getByRole("cell", {
        name: "Proposta por commercial.policy@filone.test",
      }),
    ).toBeVisible();
    // Amounts and dates are formatted for the reader, not pre-rendered.
    expect(screen.getAllByText("US$ 150,00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("A partir de 1 de jul. de 2026").length).toBe(2);
    expect(screen.getAllByText("1 TB-mês").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "2 de 2 versões · Ordenadas por moeda e, em seguida, pela versão mais recente",
      ),
    ).toBeVisible();
    // The diff row names the field in Portuguese and shows both amounts.
    expect(
      screen.getByText("LOCKED-STORAGE-TB / us-east-2 · Preço de tabela"),
    ).toBeVisible();
    for (const english of [
      "Price book versions",
      "Only activated versions set price.",
      "Proposed by",
      "rate cards",
      "Not proposed",
      "Guided demo data",
      "$150.00",
      "TB-month",
    ])
      expect(document.body.textContent).not.toContain(english);
  });

  it("colours a price-book state from the state, not from its words", () => {
    renderIn("ar");
    const table = screen.getByRole("table", {
      name: "إصدارات قوائم الأسعار ومدى الجاهزية للتفعيل",
    });
    expect(within(table).getByText("سارية")).toHaveClass(
      styles.success ?? "missing-success-class",
    );
    expect(within(table).getByText("مسودة")).toHaveClass(
      styles.warning ?? "missing-warning-class",
    );
  });
});
