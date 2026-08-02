import type { InvoiceDerivation } from "@clockwork/db";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InvoiceDerivationPanel } from "./invoice-derivation-panel";

function derivation(
  overrides: Partial<InvoiceDerivation> = {},
): InvoiceDerivation {
  return {
    invoiceId: "90000000-0000-4000-8000-000000000001",
    reference: "INV-2026-0781",
    accountId: "10000000-0000-4000-8000-000000000001",
    orderId: "80000000-0000-4000-8000-000000000001",
    orderReference: "ORD-2026-0098",
    currency: "USD",
    status: "open",
    derivedTotalMinor: "180000",
    invoicedTotalMinor: "180000",
    varianceMinor: "0",
    notes: [],
    lines: [
      {
        orderLineId: "81000000-0000-4000-8000-000000000001",
        sku: "archive-storage",
        quantity: "40",
        superseded: false,
        amountMinor: "180000",
        steps: [
          {
            key: "commitment",
            label: "Commitment period",
            source: "core_commitment_periods",
            reference: "84500000-0000-4000-8000-000000000001",
            summary: "40 consumed against 40 allowed, 0 over",
            facts: [{ label: "Adjusted allowance", value: "40" }],
            amountMinor: null,
            notes: [],
          },
          {
            key: "invoice_line",
            label: "Invoice line",
            source: "invoices",
            reference: "81000000-0000-4000-8000-000000000001",
            summary: "180000 minor USD billed for archive-storage",
            facts: [{ label: "Line amount (minor)", value: "180000" }],
            amountMinor: "180000",
            notes: [],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("invoice derivation panel", () => {
  it("nests each step and its facts inside the line that produced them", () => {
    render(<InvoiceDerivationPanel derivations={[derivation()]} />);

    const line = screen.getByRole("heading", {
      level: 4,
      name: "40 archive-storage",
    }).parentElement?.parentElement;
    if (!line) throw new Error("Expected the line to wrap its chain");
    const steps = within(line).getAllByRole("listitem");
    expect(steps).toHaveLength(2);
    expect(
      within(steps[0] as HTMLElement).getByText("Commitment period"),
    ).toBeDefined();
    expect(
      within(steps[0] as HTMLElement).getByText("Adjusted allowance"),
    ).toBeDefined();
    expect(
      within(steps[1] as HTMLElement).getByText("Line amount (minor)"),
    ).toBeDefined();
  });

  it("shows the invoiced total beside the total the rows produce", () => {
    render(<InvoiceDerivationPanel derivations={[derivation()]} />);

    expect(screen.getByText("Invoiced")).toBeDefined();
    expect(screen.getByText("From source rows")).toBeDefined();
    // Invoiced total, total from rows, the line amount, and its closing step.
    expect(screen.getAllByText("$1,800.00")).toHaveLength(4);
    expect(screen.getByText("$0.00")).toBeDefined();
  });

  it("carries an invoice-level note and leaves line notes on their line", () => {
    render(
      <InvoiceDerivationPanel
        derivations={[
          derivation({
            invoicedTotalMinor: "175000",
            varianceMinor: "5000",
            notes: [
              {
                code: "INVOICE_TOTAL_VARIANCE",
                orderLineId: null,
                message: "Line amounts do not sum to the invoiced total",
              },
              {
                code: "COMMITMENT_PERIOD_MISSING",
                orderLineId: "81000000-0000-4000-8000-000000000001",
                message: "No commitment period covers this line",
              },
            ],
          }),
        ]}
      />,
    );

    expect(screen.getByText("INVOICE_TOTAL_VARIANCE")).toBeDefined();
    // The line-scoped note belongs to its own step, not the invoice header.
    expect(screen.queryByText("COMMITMENT_PERIOD_MISSING")).toBeNull();
    expect(screen.getByText("$50.00")).toBeDefined();
  });

  it("states an account with no issued invoices", () => {
    render(<InvoiceDerivationPanel derivations={[]} />);

    expect(
      screen.getByText("This account has no issued invoices."),
    ).toBeDefined();
  });
});
