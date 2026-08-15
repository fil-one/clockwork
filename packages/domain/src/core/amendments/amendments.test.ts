import type { Money } from "@clockwork/contracts";
import { describe, expect, it } from "vitest";

import type { AcceptedOrder } from "../orders";
import { amendOrderState, type AmendmentDeltaSet } from "./index";

const usd = (minor: string) => ({ currency: "USD", minor }) as Money;

function orderWithQuantity(quantity: string, lineTotalMinor: string) {
  return {
    id: "80000000-0000-4000-8000-000000000001",
    quoteId: "70000000-0000-4000-8000-000000000001",
    quoteRevision: 1,
    agreementId: "51000000-0000-4000-8000-000000000001",
    agreementVersion: 1,
    buyerAgreementId: "51000000-0000-4000-8000-000000000001",
    buyerAgreementVersion: 1,
    accountId: "10000000-0000-4000-8000-000000000001",
    invoicingAccountId: "10000000-0000-4000-8000-000000000001",
    merchantOfRecord: "fil_one",
    sourcing: "direct",
    signerUserId: "20000000-0000-4000-8000-000000000002",
    authorityTitle: "Chief Demo Officer",
    authorityAttested: true,
    status: "active",
    serviceStartsOn: "2026-08-01",
    serviceEndsOn: "2027-07-31",
    lines: [
      {
        id: "81000000-0000-4000-8000-000000000001",
        quoteLineId: "71000000-0000-4000-8000-000000000001",
        sku: "LOCKED-STORAGE-TB",
        region: "us-east-2",
        quantity,
        termMonths: 12,
        unitPrice: usd("15000"),
        overageRate: usd("18000"),
        lineTotal: usd(lineTotalMinor),
        commitType: "period_allowance",
        stripeTaxCode: "txcd_demo",
        qboIncomeAccount: "4000",
      },
    ],
    acceptedAt: "2026-08-01T00:00:00.000Z",
    orderFormDocumentId: "40000000-0000-4000-8000-000000000001",
    provisioningKey: "order:1:v1:provision",
  } satisfies AcceptedOrder;
}

const lineId = "81000000-0000-4000-8000-000000000001";

function amendment(
  id: string,
  effectiveOn: string,
  quantityDelta: string,
  priceDeltaMinor: string,
): AmendmentDeltaSet {
  return {
    id,
    effectiveOn,
    deltas: [
      {
        orderLineId: lineId,
        sku: "LOCKED-STORAGE-TB",
        quantityDelta,
        fullPeriodPriceDelta: usd(priceDeltaMinor),
      },
    ],
  };
}

function quantityOf(order: AcceptedOrder): string {
  const line = order.lines.find((candidate) => candidate.id === lineId);
  if (!line) throw new Error("fixture line is missing");
  return line.quantity;
}

function totalOf(order: AcceptedOrder): string {
  const line = order.lines.find((candidate) => candidate.id === lineId);
  if (!line) throw new Error("fixture line is missing");
  return line.lineTotal.minor;
}

describe("amendOrderState", () => {
  // P0-49, defect 2. The fold used to sort by `(effectiveOn, id)` and floor
  // quantity at every step of the resulting replay. These three amendments are
  // each legitimate against the state that existed when they were accepted —
  // ordered 1, up to 3, back to 1, up to 2 — but replayed by effective date the
  // backdated -2 lands first against the ordered quantity of 1 and reaches -1.
  const accepted = [
    amendment("c-later-upgrade", "2027-02-01", "1", "10000"),
    amendment("a-forward-upgrade", "2027-01-01", "2", "20000"),
    amendment("b-backdated-downgrade", "2026-08-15", "-2", "-20000"),
  ] as const;

  it("folds a backdated amendment without refusing the order", () => {
    const folded = amendOrderState(orderWithQuantity("1", "180000"), [
      ...accepted,
    ]);

    expect(quantityOf(folded)).toBe("2");
    expect(totalOf(folded)).toBe("190000");
  });

  it("gives the same answer for every ordering of the same set", () => {
    // Addition of signed deltas is commutative, so a sort cannot change the
    // result — it can only change which never-existent intermediate states a
    // step-by-step check would judge. Every permutation, including the two the
    // old sort produced, has to land on the same committed state.
    const order = orderWithQuantity("1", "180000");
    const permutations: AmendmentDeltaSet[][] = [
      [accepted[0], accepted[1], accepted[2]],
      [accepted[0], accepted[2], accepted[1]],
      [accepted[1], accepted[0], accepted[2]],
      [accepted[1], accepted[2], accepted[0]],
      [accepted[2], accepted[0], accepted[1]],
      [accepted[2], accepted[1], accepted[0]],
    ];

    for (const permutation of permutations) {
      const folded = amendOrderState(order, permutation);
      expect(quantityOf(folded)).toBe("2");
      expect(totalOf(folded)).toBe("190000");
    }
  });

  it("refuses only when the folded quantity itself is negative", () => {
    // Exactly zero is the boundary and it is admitted: a line downgraded to
    // nothing is an ordinary commercial outcome.
    expect(
      quantityOf(
        amendOrderState(orderWithQuantity("1", "180000"), [
          ...accepted,
          amendment("d-to-zero", "2026-12-01", "-2", "-20000"),
        ]),
      ),
    ).toBe("0");
    expect(() =>
      amendOrderState(orderWithQuantity("1", "180000"), [
        ...accepted,
        amendment("d-to-zero", "2026-12-01", "-2", "-20000"),
        amendment("e-below-zero", "2026-12-15", "-1", "-10000"),
      ]),
    ).toThrow("committed quantity negative");
  });

  it("floors revenue across the order rather than per line", () => {
    expect(() =>
      amendOrderState(orderWithQuantity("1", "180000"), [
        amendment("f-credit", "2026-09-01", "-1", "-1000000"),
      ]),
    ).toThrow("committed revenue negative");
  });

  it("leaves an unamended order exactly as it was", () => {
    const folded = amendOrderState(orderWithQuantity("3", "540000"), []);

    expect(quantityOf(folded)).toBe("3");
    expect(totalOf(folded)).toBe("540000");
  });

  // P0-49, defect 2, round 4. The branch above never runs a delta that omits
  // `orderLineId`, which is the branch the doc comment reasons about and where
  // the composition defect lived. A line swap is the ordinary shape: supersede
  // the original line for its book value plus a negotiated credit and add a
  // replacement line worth more than both.
  const swap: AmendmentDeltaSet = {
    id: "swap",
    effectiveOn: "2026-09-01",
    deltas: [
      {
        orderLineId: lineId,
        sku: "LOCKED-STORAGE-TB",
        quantityDelta: "-1",
        fullPeriodPriceDelta: usd("-200000"),
      },
      {
        sku: "LOCKED-STORAGE-TB",
        quantityDelta: "1",
        fullPeriodPriceDelta: usd("250000"),
      },
    ],
  };

  it("counts an added line's revenue and does not return the line", () => {
    const folded = amendOrderState(orderWithQuantity("1", "180000"), [swap]);

    // Admitted: committed revenue is (180000 - 200000) + 250000 = 230000.
    // The order's own line is left at the negotiated credit alone, and the
    // added line is not returned — it has no `order_lines` identity for a
    // later amendment to address.
    expect(folded.lines).toHaveLength(1);
    expect(quantityOf(folded)).toBe("0");
    expect(totalOf(folded)).toBe("-20000");
  });

  it("is not idempotent, so the whole history folds in one call", () => {
    // This is the defect, stated as the property that fails. Folding the RESULT
    // of a fold drops the added revenue the first call counted, and an order
    // that is comfortably in the black reads as negative.
    const ordered = orderWithQuantity("1", "180000");
    const upgrade = amendment("post-swap-upgrade", "2026-10-01", "1", "15000");

    expect(() =>
      amendOrderState(amendOrderState(ordered, [swap]), [upgrade]),
    ).toThrow("committed revenue negative");

    // One fold over the same history: same per-line sums, correct total.
    const folded = amendOrderState(ordered, [swap, upgrade]);
    expect(quantityOf(folded)).toBe("1");
    expect(totalOf(folded)).toBe("-5000");
  });

  it("admits an amendment moving no money against a swapped order", () => {
    const folded = amendOrderState(orderWithQuantity("1", "180000"), [
      swap,
      { id: "term-extension", effectiveOn: "2026-11-01", deltas: [] },
    ]);

    expect(totalOf(folded)).toBe("-20000");
  });

  it("floors the order total with the added revenue in scope", () => {
    // Counting added revenue does not weaken the floor, it just puts the right
    // number under it. Two units ordered at 360000, the swap supersedes one for
    // 200000 and adds a line worth 250000, so committed revenue is
    // (360000 - 200000) + 250000 = 410000 and the remaining unit is what a
    // further downgrade has to spend. Exactly 410000 of credit lands on zero
    // and is admitted; one minor unit more is refused.
    const credit = (minor: string) =>
      amendment("credit", "2026-12-01", "-1", minor);

    expect(
      totalOf(
        amendOrderState(orderWithQuantity("2", "360000"), [
          swap,
          credit("-410000"),
        ]),
      ),
    ).toBe("-250000");
    expect(() =>
      amendOrderState(orderWithQuantity("2", "360000"), [
        swap,
        credit("-410001"),
      ]),
    ).toThrow("committed revenue negative");
  });
});
