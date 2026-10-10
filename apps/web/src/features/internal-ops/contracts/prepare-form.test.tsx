import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type {
  TemplateField,
  TemplateLineItems,
  TemplateValue,
} from "@clockwork/contracts";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  prepare: vi.fn(),
  list: vi.fn(),
  importLines: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: vi.fn() }),
}));
vi.mock("./actions", () => ({ prepareContract: mocks.prepare }));
vi.mock("./scenario-import", () => ({
  listImportableScenarios: mocks.list,
  importScenarioLineItems: mocks.importLines,
}));
import { PrepareForm } from "./prepare-form";

const scenarioId = "019a44ac-0000-7000-8000-00000000ab01";
const fields: TemplateField[] = [
  {
    id: "fixture_reference",
    kind: "text",
    required: true,
    maxLength: 80,
    label: { en: "Fixture reference" },
  },
  {
    id: "order_lines",
    kind: "line_items",
    required: true,
    label: { en: "Order lines" },
  },
];

const link = {
  id: scenarioId,
  name: "Acme Q4",
  version: 2,
  asOf: "2026-10-09",
};
const importedTable: TemplateLineItems = {
  currency: "EUR",
  scenario: link,
  rows: [
    {
      sku: "STORAGE-TB",
      description: "",
      region: "eu-west",
      unit: "TB-month",
      quantity: "500",
      termMonths: 12,
      unitPriceMinor: "1500",
      minimumQuantity: "10",
      discountBps: 1000,
      extendedMinor: "8100000",
      scenarioLine: 0,
    },
  ],
};

function renderForm(initialValues?: Record<string, TemplateValue>) {
  render(
    <PrepareForm
      {...(initialValues ? { initialValues } : {})}
      template={{ id: "test-fixture", requiresApproval: true, fields }}
      countersigners={[
        {
          id: "019a44ac-0000-7000-8000-000000000001",
          name: "James Kurz",
          title: "CFO/CSO",
          email: "james@fil.one",
          isDefault: true,
        },
      ]}
      ownerName="Seller"
      today="2026-10-10"
      signingReady
    />,
  );
}

async function fillParties(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Counterparty legal name/), "Bluefin");
  await user.type(screen.getByLabelText("Signer's full name"), "Alex");
  await user.type(screen.getByLabelText("Signer's email"), "alex@example.com");
  await user.type(screen.getByLabelText("Signer's job title"), "CEO");
  await user.type(screen.getByLabelText("Fixture reference"), "REF-7");
}

const submittedLines = () =>
  (
    mocks.prepare.mock.calls[0]?.[0] as {
      values: { order_lines: unknown };
    }
  ).values.order_lines;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue({
    ok: true,
    value: { id: "019a44ac-0000-7000-8000-0000000000c9" },
  });
});

it("prices lines typed by hand and submits them as one table", async () => {
  const user = userEvent.setup();
  renderForm();
  await fillParties(user);
  expect(
    screen.getByText("The total appears when every line is complete."),
  ).toBeInTheDocument();
  await user.type(screen.getByLabelText("Item"), "SUPPORT");
  await user.type(screen.getByLabelText("Unit"), "month");
  await user.type(screen.getByLabelText("Unit price (USD)"), "1,000");
  expect(screen.getByText("Extended price $12,000.00")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Total$12,000.00");
  await user.click(screen.getByRole("button", { name: "Add line" }));
  expect(screen.getAllByLabelText("Item")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Remove line 2" }));
  await user.click(screen.getByRole("button", { name: "Prepare document" }));
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
  expect(submittedLines()).toEqual({
    currency: "USD",
    rows: [
      {
        sku: "SUPPORT",
        description: "",
        region: "",
        unit: "month",
        quantity: "1",
        termMonths: 12,
        unitPriceMinor: "100000",
        minimumQuantity: "0",
        discountBps: 0,
        extendedMinor: "1200000",
      },
    ],
  });
});

it("imports a saved scenario's lines and currency, which stay editable within the scenario rules", async () => {
  const user = userEvent.setup();
  mocks.list.mockResolvedValue({
    ok: true,
    value: [
      {
        id: scenarioId,
        name: "Acme Q4",
        company: "Acme",
        ownerName: "Seller",
        asOf: "2026-10-09",
        lineCount: 1,
        total: { currency: "EUR", minor: "8100000" },
      },
    ],
  });
  mocks.importLines.mockResolvedValue({
    ok: true,
    value: { kind: "lines", lineItems: importedTable },
  });
  renderForm();
  await fillParties(user);
  await user.click(
    screen.getByRole("button", { name: "Import from pricing scenario" }),
  );
  expect(
    await screen.findByRole("option", { name: "Acme Q4, Acme (€81,000.00)" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Import lines" }));
  expect(mocks.importLines).toHaveBeenCalledWith({ id: scenarioId });
  expect(await screen.findByLabelText("Item")).toHaveValue("STORAGE-TB");
  expect(screen.getByRole("note")).toHaveTextContent(
    "Lines from the scenario Acme Q4, list prices as of Oct 9, 2026.",
  );
  expect(screen.getByLabelText("Currency")).toBeDisabled();
  expect(screen.getByLabelText("Currency")).toHaveValue("EUR");

  const quantity = screen.getByLabelText("Quantity");
  await user.clear(quantity);
  await user.type(quantity, "5");
  expect(
    screen.getByText("This is below the rate's minimum of 10 TB-month."),
  ).toBeInTheDocument();
  await user.clear(quantity);
  await user.type(quantity, "600");
  await user.type(screen.getByLabelText(/Description/), "Hot storage");
  await user.click(screen.getByRole("button", { name: "Prepare document" }));
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
  expect(submittedLines()).toMatchObject({
    currency: "EUR",
    scenario: link,
    rows: [
      {
        sku: "STORAGE-TB",
        description: "Hot storage",
        quantity: "600",
        minimumQuantity: "10",
        // 15.00 less 10% x 600 x 12.
        extendedMinor: "9720000",
        scenarioLine: 0,
      },
    ],
  });
});

it("detaches a table from its scenario and keeps the lines", async () => {
  const user = userEvent.setup();
  renderForm({ order_lines: importedTable });
  expect(screen.getByLabelText("Item")).toHaveValue("STORAGE-TB");
  expect(screen.getByRole("note")).toHaveTextContent("Acme Q4");
  await user.click(screen.getByRole("button", { name: "Detach scenario" }));
  expect(screen.queryByRole("note")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Currency")).toBeEnabled();
  await fillParties(user);
  await user.click(screen.getByRole("button", { name: "Prepare document" }));
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
  const submitted = submittedLines() as TemplateLineItems;
  expect(submitted).not.toHaveProperty("scenario");
  expect(submitted.rows[0]).not.toHaveProperty("scenarioLine");
  expect(submitted.rows[0]).toMatchObject({
    sku: "STORAGE-TB",
    extendedMinor: "8100000",
  });
});

it("names the scenario line that cannot be imported", async () => {
  const user = userEvent.setup();
  mocks.list.mockResolvedValue({
    ok: true,
    value: [
      {
        id: scenarioId,
        name: "Acme Q4",
        company: "Acme",
        ownerName: "Seller",
        asOf: "2026-10-09",
        lineCount: 2,
        total: { currency: "EUR", minor: "8100000" },
      },
    ],
  });
  mocks.importLines.mockResolvedValue({
    ok: true,
    value: { kind: "refused", line: 2, code: "characters" },
  });
  renderForm();
  await user.click(
    screen.getByRole("button", { name: "Import from pricing scenario" }),
  );
  await user.click(await screen.findByRole("button", { name: "Import lines" }));
  expect(
    await screen.findByText(
      /Line 2 of this scenario cannot be used in the agreement\. Use Latin letters/,
    ),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Item")).toHaveValue("");
});

it("says when there is nothing to import and shows the server's line-item refusal", async () => {
  const user = userEvent.setup();
  mocks.list.mockResolvedValue({ ok: true, value: [] });
  mocks.prepare.mockResolvedValue({
    ok: false,
    code: "INVALID_INPUT",
    fields: { "values.order_lines": "below_minimum" },
  });
  renderForm();
  await user.click(
    screen.getByRole("button", { name: "Import from pricing scenario" }),
  );
  expect(
    await screen.findByText(/No saved pricing scenarios yet/),
  ).toBeInTheDocument();
  await fillParties(user);
  await user.click(screen.getByRole("button", { name: "Prepare document" }));
  const message =
    "A line is below its rate's minimum quantity. Raise it to the minimum.";
  const link = await screen.findByRole("link", {
    name: `Order lines: ${message}`,
  });
  const target = link.getAttribute("href") ?? "";
  expect(target).toMatch(/-values-order_lines$/);
  // The summary links to the editor, which repeats the refusal.
  expect(document.getElementById(target.slice(1))).toHaveTextContent(message);
});

it("starts from a voided contract's values, its line items included, with the signer left blank", () => {
  render(
    <PrepareForm
      template={{ id: "test-fixture", requiresApproval: true, fields }}
      countersigners={[
        {
          id: "019a44ac-0000-7000-8000-000000000001",
          name: "James Kurz",
          title: "CFO/CSO",
          email: "james@fil.one",
          isDefault: false,
        },
        {
          id: "019a44ac-0000-7000-8000-000000000002",
          name: "Default Signer",
          title: "CEO",
          email: "default@fil.one",
          isDefault: true,
        },
      ]}
      ownerName="Seller"
      today="2026-10-10"
      signingReady
      start={{
        counterpartyName: "Bluefin Data Co.",
        effectiveDate: "2026-10-05",
        ownerName: "R.W. Holleman",
        countersignerId: "019a44ac-0000-7000-8000-000000000001",
        values: { fixture_reference: "REF-7", order_lines: importedTable },
      }}
    />,
  );
  expect(
    screen.getByText("Values from the voided contract"),
  ).toBeInTheDocument();
  expect(screen.getByLabelText(/Counterparty legal name/)).toHaveValue(
    "Bluefin Data Co.",
  );
  expect(screen.getByLabelText("Effective date")).toHaveValue("2026-10-05");
  expect(screen.getByLabelText("Fixture reference")).toHaveValue("REF-7");
  expect(screen.getByLabelText("Item")).toHaveValue("STORAGE-TB");
  expect(screen.getByRole("note")).toHaveTextContent("Acme Q4");
  expect(screen.getByLabelText(/Fil One countersigner/)).toHaveValue(
    "019a44ac-0000-7000-8000-000000000001",
  );
  expect(screen.getByLabelText("Signer's full name")).toHaveValue("");
  expect(screen.getByLabelText("Signer's email")).toHaveValue("");
});
