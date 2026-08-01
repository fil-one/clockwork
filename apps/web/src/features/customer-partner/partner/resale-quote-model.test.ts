import { describe, expect, it } from "vitest";

import {
  clientOptions,
  offerOptions,
  quoteReviewSummary,
  resolveSelectorId,
  validateResaleQuoteStage,
  type ResaleQuoteDraft,
} from "./resale-quote-model";

const validDraft: ResaleQuoteDraft = {
  offerName: offerOptions[0].name,
  region: "us-east",
  capacity: "120",
  termMonths: "12",
  route: "resale",
  endClientName: clientOptions[0].name,
  expiresAt: "2026-08-31T17:00:00.000Z",
  resalePrice: "68400",
};

describe("human-readable partner quote selectors", () => {
  it("resolves names case-insensitively to existing IDs", () => {
    expect(
      resolveSelectorId(offerOptions[0].name.toUpperCase(), offerOptions),
    ).toBe(offerOptions[0].id);
    expect(resolveSelectorId(clientOptions[1].name, clientOptions)).toBe(
      clientOptions[1].id,
    );
    expect(
      resolveSelectorId("33333333-3333-4333-8333-333333333333", clientOptions),
    ).toBeUndefined();
  });
});

describe("partner quote workflow validation", () => {
  it("validates only the first stage before advancing", () => {
    const errors = validateResaleQuoteStage(
      1,
      { ...validDraft, capacity: "0" },
      new Date("2026-07-31T16:00:00Z"),
    );
    expect(errors).toEqual({});
  });

  it("identifies every invalid commercial field at review", () => {
    const errors = validateResaleQuoteStage(
      3,
      {
        ...validDraft,
        capacity: "9",
        termMonths: "1.5",
        endClientName: "Unknown",
        expiresAt: "2026-01-01T00:00:00Z",
        resalePrice: "0",
      },
      new Date("2026-07-31T16:00:00Z"),
    );
    expect(Object.keys(errors)).toEqual([
      "capacity",
      "termMonths",
      "endClientName",
      "expiresAt",
      "resalePrice",
    ]);
  });

  it("creates a review summary with price and server-truth boundaries", () => {
    const summary = quoteReviewSummary(validDraft).join(" ");
    expect(summary).toContain("Partner resale price: $68,400.00");
    expect(summary).toContain("authoritative transfer price");
    expect(summary).toContain("Halcyon Research Cooperative");
  });
});
