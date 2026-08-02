import { describe, expect, it } from "vitest";

import {
  deriveInvoice,
  type DerivationNoteCode,
  type DerivationStepKey,
  type InvoiceDerivation,
  type InvoiceDerivationInput,
} from "./index";

function baseInput(): InvoiceDerivationInput {
  return {
    invoice: {
      id: "90000000-0000-4000-8000-000000000001",
      reference: "INV-2026-0781",
      orderId: "80000000-0000-4000-8000-000000000001",
      accountId: "10000000-0000-4000-8000-000000000001",
      currency: "USD",
      amountMinor: "180000",
      status: "open",
      issuedAt: "2026-06-01T00:00:00.000Z",
    },
    order: {
      id: "80000000-0000-4000-8000-000000000001",
      reference: "ORD-2026-0098",
      accountId: "10000000-0000-4000-8000-000000000001",
      quoteId: "70000000-0000-4000-8000-000000000001",
      status: "active",
      serviceStartsOn: "2026-01-01",
      serviceEndsOn: "2026-12-31",
    },
    orderLines: [
      {
        id: "81000000-0000-4000-8000-000000000001",
        sku: "archive-storage",
        quantity: "40",
        unitPriceMinor: "4500",
        overageRateMinor: "600",
        supersededByAmendmentId: null,
        snapshotHash: "a".repeat(64),
        snapshotCapturedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    quoteSnapshot: {
      quoteId: "70000000-0000-4000-8000-000000000001",
      revision: 3,
      snapshotHash: "b".repeat(64),
      issuedAt: "2025-12-01T00:00:00.000Z",
    },
    entitlements: [
      {
        id: "83000000-0000-4000-8000-000000000001",
        orderLineId: "81000000-0000-4000-8000-000000000001",
        sku: "archive-storage",
        committedQuantity: "40",
        region: "eu-madrid",
        status: "active",
        activatedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
    usageReconciliations: [
      {
        id: "84400000-0000-4000-8000-000000000001",
        entitlementId: "83000000-0000-4000-8000-000000000001",
        periodStartsAt: "2026-01-01T00:00:00.000Z",
        periodEndsAt: "2027-01-01T00:00:00.000Z",
        sourceSystem: "provisioning",
        sourceQuantity: "40",
        ledgerQuantity: "40",
        varianceQuantity: "0",
        status: "matched",
        resolution: null,
      },
    ],
    commitmentPeriods: [
      {
        id: "84500000-0000-4000-8000-000000000001",
        ledgerId: "84000000-0000-4000-8000-000000000001",
        orderLineId: "81000000-0000-4000-8000-000000000001",
        sequence: 1,
        startsAt: "2026-01-01T00:00:00.000Z",
        endsAt: "2027-01-01T00:00:00.000Z",
        allowanceQuantity: "40",
        consumedQuantity: "40",
        overageQuantity: "0",
        contractedOverageRateMinor: "600",
        status: "open",
      },
    ],
    allowanceAdjustments: [],
    supersessions: [],
  };
}

function codes(derivation: InvoiceDerivation): DerivationNoteCode[] {
  return derivation.notes.map((entry) => entry.code);
}

function step(derivation: InvoiceDerivation, key: DerivationStepKey) {
  const found = derivation.lines[0]?.steps.find((entry) => entry.key === key);
  if (!found) throw new Error(`Step ${key} is missing`);
  return found;
}

describe("invoice derivation", () => {
  it("walks quote, order line, entitlement, usage, commitment, rate and invoice line", () => {
    const derivation = deriveInvoice(baseInput());

    expect(derivation.lines[0]?.steps.map((entry) => entry.key)).toEqual([
      "quote",
      "order_line",
      "entitlement",
      "usage",
      "commitment",
      "rate",
      "invoice_line",
    ]);
    expect(step(derivation, "quote").reference).toBe(
      "70000000-0000-4000-8000-000000000001",
    );
    expect(step(derivation, "entitlement").reference).toBe(
      "83000000-0000-4000-8000-000000000001",
    );
    expect(step(derivation, "usage").reference).toBe(
      "84400000-0000-4000-8000-000000000001",
    );
    expect(step(derivation, "commitment").reference).toBe(
      "84500000-0000-4000-8000-000000000001",
    );
    expect(derivation.derivedTotalMinor).toBe("180000");
    expect(derivation.invoicedTotalMinor).toBe("180000");
    expect(derivation.varianceMinor).toBe("0");
    expect(codes(derivation)).toEqual([]);
  });

  it("names every source table so a reader can reach the rows", () => {
    const derivation = deriveInvoice(baseInput());

    expect(derivation.lines[0]?.steps.map((entry) => entry.source)).toEqual([
      "core_quote_snapshots",
      "core_order_line_snapshots",
      "entitlements",
      "core_usage_reconciliations",
      "core_commitment_periods",
      "core_commitment_periods",
      "invoices",
    ]);
  });

  it("prices overage at the contracted rate on top of the committed amount", () => {
    const input = baseInput();
    const period = input.commitmentPeriods[0];
    if (!period) throw new Error("fixture requires a commitment period");
    const derivation = deriveInvoice({
      ...input,
      invoice: { ...input.invoice, amountMinor: "183000" },
      commitmentPeriods: [
        { ...period, consumedQuantity: "45", overageQuantity: "5" },
      ],
    });

    // 40 × 4500 committed, plus 5 × 600 overage.
    expect(step(derivation, "rate").amountMinor).toBe("183000");
    expect(derivation.derivedTotalMinor).toBe("183000");
    expect(derivation.varianceMinor).toBe("0");
    expect(codes(derivation)).toEqual([]);
  });

  it("applies allowance adjustments before judging recorded overage", () => {
    const input = baseInput();
    const period = input.commitmentPeriods[0];
    if (!period) throw new Error("fixture requires a commitment period");
    const derivation = deriveInvoice({
      ...input,
      invoice: { ...input.invoice, amountMinor: "183000" },
      commitmentPeriods: [
        { ...period, consumedQuantity: "55", overageQuantity: "5" },
      ],
      allowanceAdjustments: [
        {
          id: "84600000-0000-4000-8000-000000000001",
          ledgerId: "84000000-0000-4000-8000-000000000001",
          periodId: "84500000-0000-4000-8000-000000000001",
          effectiveAt: "2026-03-01T00:00:00.000Z",
          quantityDelta: "10",
          reason: "amendment",
          sourceReference: "AMD-2026-0004",
        },
      ],
    });

    const commitment = step(derivation, "commitment");
    expect(
      commitment.facts.find((fact) => fact.label === "Adjusted allowance")
        ?.value,
    ).toBe("50");
    // 55 consumed against 50 allowed is the 5 already recorded, so no variance.
    expect(commitment.notes).toEqual([]);
    expect(codes(derivation)).toEqual([]);
  });

  it("reports overage that disagrees with consumption above the allowance", () => {
    const input = baseInput();
    const period = input.commitmentPeriods[0];
    if (!period) throw new Error("fixture requires a commitment period");
    const derivation = deriveInvoice({
      ...input,
      invoice: { ...input.invoice, amountMinor: "181200" },
      commitmentPeriods: [
        { ...period, consumedQuantity: "50", overageQuantity: "2" },
      ],
    });

    expect(codes(derivation)).toContain("COMMITMENT_OVERAGE_VARIANCE");
    expect(step(derivation, "commitment").notes[0]?.orderLineId).toBe(
      "81000000-0000-4000-8000-000000000001",
    );
  });

  it("falls back to the order line rate when no commitment period covers the line", () => {
    const derivation = deriveInvoice({
      ...baseInput(),
      commitmentPeriods: [],
      allowanceAdjustments: [],
    });

    expect(codes(derivation)).toContain("COMMITMENT_PERIOD_MISSING");
    expect(step(derivation, "commitment").reference).toBeNull();
    expect(step(derivation, "rate").source).toBe("order_lines");
    expect(
      step(derivation, "rate").facts.find(
        (fact) => fact.label === "Overage rate (minor)",
      )?.value,
    ).toBe("600");
    // No period means no recorded overage, so the committed amount stands.
    expect(derivation.derivedTotalMinor).toBe("180000");
  });

  it("marks an entitlement with no usage reconciliation", () => {
    const derivation = deriveInvoice({
      ...baseInput(),
      usageReconciliations: [],
    });

    expect(codes(derivation)).toContain("USAGE_RECONCILIATION_MISSING");
    expect(step(derivation, "usage").reference).toBeNull();
    expect(step(derivation, "usage").summary).toBe(
      "No reconciliation recorded",
    );
    expect(derivation.derivedTotalMinor).toBe("180000");
  });

  it("marks an unresolved source variance and leaves a resolved one quiet", () => {
    const input = baseInput();
    const reconciliation = input.usageReconciliations[0];
    if (!reconciliation) throw new Error("fixture requires a reconciliation");
    const open = deriveInvoice({
      ...input,
      usageReconciliations: [
        {
          ...reconciliation,
          sourceQuantity: "42",
          varianceQuantity: "-2",
          status: "variance",
        },
      ],
    });
    const resolved = deriveInvoice({
      ...input,
      usageReconciliations: [
        {
          ...reconciliation,
          sourceQuantity: "42",
          varianceQuantity: "-2",
          status: "variance",
          resolution: "Source replay accepted",
        },
      ],
    });

    expect(codes(open)).toContain("USAGE_VARIANCE_OPEN");
    expect(codes(resolved)).not.toContain("USAGE_VARIANCE_OPEN");
  });

  it("carries an amendment supersession into the line amount", () => {
    const input = baseInput();
    const line = input.orderLines[0];
    if (!line) throw new Error("fixture requires an order line");
    const derivation = deriveInvoice({
      ...input,
      invoice: { ...input.invoice, amountMinor: "225000" },
      orderLines: [
        {
          ...line,
          supersededByAmendmentId: "82000000-0000-4000-8000-000000000001",
        },
      ],
      supersessions: [
        {
          id: "82100000-0000-4000-8000-000000000001",
          amendmentId: "82000000-0000-4000-8000-000000000001",
          supersededOrderLineId: "81000000-0000-4000-8000-000000000001",
          effectiveOn: "2026-06-01",
          netQuantityDelta: "10",
          netRevenueDeltaMinor: "45000",
        },
      ],
    });

    expect(derivation.lines[0]?.superseded).toBe(true);
    expect(codes(derivation)).toContain("LINE_SUPERSEDED");
    // 40 × 4500 as ordered, plus the 45000 minor the amendment added.
    expect(step(derivation, "order_line").amountMinor).toBe("225000");
    expect(derivation.derivedTotalMinor).toBe("225000");
    expect(derivation.varianceMinor).toBe("0");
  });

  it("reports a missing quote snapshot without losing the order line", () => {
    const derivation = deriveInvoice({ ...baseInput(), quoteSnapshot: null });

    expect(codes(derivation)).toContain("QUOTE_SNAPSHOT_MISSING");
    expect(step(derivation, "quote").reference).toBe(
      "70000000-0000-4000-8000-000000000001",
    );
    expect(derivation.derivedTotalMinor).toBe("180000");
  });

  it("reports a missing order line snapshot and reads the current row", () => {
    const input = baseInput();
    const line = input.orderLines[0];
    if (!line) throw new Error("fixture requires an order line");
    const derivation = deriveInvoice({
      ...input,
      orderLines: [{ ...line, snapshotHash: null, snapshotCapturedAt: null }],
    });

    expect(codes(derivation)).toContain("ORDER_LINE_SNAPSHOT_MISSING");
    expect(
      step(derivation, "order_line").facts.find(
        (fact) => fact.label === "Snapshot hash",
      )?.value,
    ).toBe("Not stored");
    expect(derivation.derivedTotalMinor).toBe("180000");
  });

  it("reports a line with no entitlement and keeps usage and commitment empty", () => {
    const derivation = deriveInvoice({
      ...baseInput(),
      entitlements: [],
      usageReconciliations: [],
      commitmentPeriods: [],
    });

    expect(codes(derivation)).toEqual([
      "ENTITLEMENT_MISSING",
      "COMMITMENT_PERIOD_MISSING",
    ]);
    expect(step(derivation, "usage").notes).toEqual([]);
    expect(derivation.derivedTotalMinor).toBe("180000");
  });

  it("names the variance when the lines do not sum to the invoiced total", () => {
    const input = baseInput();
    const derivation = deriveInvoice({
      ...input,
      invoice: { ...input.invoice, amountMinor: "175000" },
    });

    expect(derivation.varianceMinor).toBe("5000");
    expect(codes(derivation)).toEqual(["INVOICE_TOTAL_VARIANCE"]);
    expect(derivation.notes[0]?.orderLineId).toBeNull();
  });

  it("derives every line of a multi-line order independently", () => {
    const input = baseInput();
    const line = input.orderLines[0];
    if (!line) throw new Error("fixture requires an order line");
    const derivation = deriveInvoice({
      ...input,
      invoice: { ...input.invoice, amountMinor: "240000" },
      orderLines: [
        line,
        {
          id: "81000000-0000-4000-8000-000000000002",
          sku: "egress",
          quantity: "12",
          unitPriceMinor: "5000",
          overageRateMinor: "700",
          supersededByAmendmentId: null,
          snapshotHash: "c".repeat(64),
          snapshotCapturedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(derivation.lines.map((entry) => entry.amountMinor)).toEqual([
      "180000",
      "60000",
    ]);
    expect(derivation.derivedTotalMinor).toBe("240000");
    // The second line has no entitlement or commitment of its own.
    expect(
      derivation.notes.filter(
        (entry) => entry.orderLineId === "81000000-0000-4000-8000-000000000002",
      ).length,
    ).toBe(2);
  });

  it("handles fractional quantities without floating point drift", () => {
    const input = baseInput();
    const line = input.orderLines[0];
    if (!line) throw new Error("fixture requires an order line");
    const derivation = deriveInvoice({
      ...input,
      invoice: { ...input.invoice, amountMinor: "182250" },
      orderLines: [{ ...line, quantity: "40.5" }],
      commitmentPeriods: [],
    });

    expect(derivation.lines[0]?.amountMinor).toBe("182250");
    expect(derivation.varianceMinor).toBe("0");
  });
});
