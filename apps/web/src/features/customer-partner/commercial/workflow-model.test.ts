import { describe, expect, it } from "vitest";

import {
  firstQuoteError,
  orderReviewSummary,
  quotePayload,
  quoteSelectorOptions,
  quoteStageLabels,
  resolveSelectorId,
  validQuoteActions,
  validateQuoteStage,
  type QuoteDraft,
} from "./workflow-model";

const validDraft: QuoteDraft = {
  account: "Northstar Archive Labs",
  offer: "Enterprise archive capacity",
  region: "us-east",
  capacity: "120",
  termMonths: "12",
  route: "direct",
  endClient: "",
  partner: "",
  expiresAt: "2026-08-31T17:00",
};

describe("quote workflow model", () => {
  it("exposes exactly three ordered creation stages", () => {
    expect(quoteStageLabels).toEqual([
      "Offer and region",
      "Capacity, term, route, end client or partner, and expiry",
      "Review and issue",
    ]);
  });

  it("resolves human-readable searchable selector values to existing IDs", () => {
    expect(
      resolveSelectorId(
        "Northstar Archive Labs",
        quoteSelectorOptions.accounts,
      ),
    ).toBe("11111111-1111-4111-8111-111111111111");
    expect(
      resolveSelectorId(
        "44444444-4444-4444-8444-444444444444",
        quoteSelectorOptions.offers,
      ),
    ).toBe("44444444-4444-4444-8444-444444444444");
    expect(
      resolveSelectorId("Unknown account", quoteSelectorOptions.accounts),
    ).toBeUndefined();
  });

  it("validates by stage and identifies the first field to focus", () => {
    const errors = validateQuoteStage(2, {
      ...validDraft,
      capacity: "4",
      termMonths: "0",
      expiresAt: "",
    });
    expect(errors.capacity).toContain("at least 10 TB");
    expect(errors.termMonths).toContain("between 1 and 60");
    expect(errors.expiresAt).toContain("date and time");
    expect(firstQuoteError(errors)).toBe("capacity");
  });

  it("requires named commercial parties for a resale route", () => {
    const errors = validateQuoteStage(2, {
      ...validDraft,
      route: "resale",
    });
    expect(errors.endClient).toBeTruthy();
    expect(errors.partner).toBeTruthy();
  });

  it("submits IDs and the established quote payload shape", () => {
    const result = quotePayload(validDraft);
    expect(result.accountId).toBe("11111111-1111-4111-8111-111111111111");
    expect(result.payload).toMatchObject({
      priceBookId: "44444444-4444-4444-8444-444444444444",
      route: "direct",
      expiresAt: "2026-08-31T21:00:00.000Z",
      lines: [
        {
          sku: "FIL-ARCHIVE-CAPACITY",
          region: "us-east",
          quantity: "120",
          termMonths: 12,
        },
      ],
    });
  });

  it("exposes actions valid for each server quote status only", () => {
    expect(validQuoteActions("draft")).toEqual(["edit", "issue", "cancel"]);
    expect(validQuoteActions("open")).toEqual(["accept", "cancel"]);
    expect(validQuoteActions("accepted")).toEqual(["create_order"]);
    expect(validQuoteActions("canceled")).toEqual([]);
  });

  it("builds the complete order acceptance review summary", () => {
    expect(
      orderReviewSummary({
        agreementTitle: "Cloud Service Agreement",
        agreementVersion: "3.2",
        capacity: "120 TB",
        poNumber: "PO-NA-1092",
        quoteTitle: "Compliance replica renewal",
        quoteVersion: "2",
        serviceStart: "Aug 15, 2026",
        spend: "$55,440.00",
      }),
    ).toEqual({
      quote: "Compliance replica renewal · version 2 · accepted",
      agreement: "Cloud Service Agreement · version 3.2 · active",
      purchaseOrder: "PO-NA-1092",
      serviceStart: "Aug 15, 2026",
      commitment: "120 TB committed · $55,440.00 estimated annual spend",
    });
  });
});
