import { describe, expect, it } from "vitest";

import {
  emptyQuoteDraft,
  firstQuoteError,
  orderReviewSummary,
  quotePayload,
  prefilledQuoteDraft,
  quoteStageLabels,
  resolveSelectorId,
  validQuoteActions,
  validateQuoteStage,
  type QuoteDraft,
} from "./workflow-model";
import {
  authoritativeQuoteOffer,
  authoritativeQuoteOffers,
} from "./quote-offer.test-fixture";

const accounts = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    label: "Northstar Archive Labs",
  },
];

const validDraft: QuoteDraft = {
  account: "Northstar Archive Labs",
  offer: authoritativeQuoteOffer.label,
  region: "us-east-2",
  capacity: "120",
  termMonths: "12",
  // A datetime-local field carries no offset, so 17:00 means 17:00 wherever the
  // seller is. The expected instant is built from the same local parts rather
  // than pinned to one machine's offset.
  expiresAt: "2026-08-31T17:00",
};

describe("quote workflow model", () => {
  it("exposes exactly three ordered creation stages", () => {
    expect(quoteStageLabels).toEqual([
      "Offer and region",
      "Capacity, term, direct route, and expiry",
      "Review and issue",
    ]);
  });

  it("prefills capacity and term without changing the customer route", () => {
    expect(
      prefilledQuoteDraft("Northstar Archive Labs", {
        capacity: "100",
        termMonths: "12",
      }),
    ).toEqual({
      ...validDraft,
      offer: "",
      region: "",
      capacity: "100",
      expiresAt: "",
    });
  });

  it("resolves human-readable searchable selector values to existing IDs", () => {
    expect(resolveSelectorId("Northstar Archive Labs", accounts)).toBe(
      "10000000-0000-4000-8000-000000000001",
    );
    expect(
      resolveSelectorId(authoritativeQuoteOffer.id, authoritativeQuoteOffers),
    ).toBe(authoritativeQuoteOffer.id);
    expect(resolveSelectorId("Unknown account", accounts)).toBeUndefined();
  });

  it("starts a draft with no commercial facts beyond the session account", () => {
    expect(emptyQuoteDraft("Northstar Archive Labs")).toMatchObject({
      account: "Northstar Archive Labs",
      offer: "",
      capacity: "",
      termMonths: "",
      expiresAt: "",
    });
  });

  it("validates by stage and identifies the first field to focus", () => {
    const errors = validateQuoteStage(
      2,
      {
        ...validDraft,
        capacity: "4",
        termMonths: "0",
        expiresAt: "",
      },
      accounts,
      authoritativeQuoteOffers,
    );
    expect(errors.capacity).toContain("at least 10 TB");
    expect(errors.termMonths).toContain("between 1 and 60");
    expect(errors.expiresAt).toContain("date and time");
    expect(firstQuoteError(errors)).toBe("capacity");
  });

  it("submits a direct-only customer payload with no partner fixture identities", () => {
    const result = quotePayload(validDraft, accounts, authoritativeQuoteOffers);
    expect(result.accountId).toBe("10000000-0000-4000-8000-000000000001");
    expect(result.payload).toMatchObject({
      priceBookId: authoritativeQuoteOffer.priceBookId,
      route: "direct",
      expiresAt: new Date(2026, 7, 31, 17, 0).toISOString(),
      lines: [
        {
          sku: authoritativeQuoteOffer.sku,
          region: authoritativeQuoteOffer.region,
          quantity: "120",
          termMonths: 12,
        },
      ],
    });
    expect(result.payload).not.toHaveProperty("endClientAccountId");
    expect(result.payload).not.toHaveProperty("partnerAccountId");
    expect(result.payload).not.toHaveProperty("marketplaceProvider");
  });

  it("maps same-claim same-region labels to the chosen book and SKU", () => {
    const otherOffer = {
      ...authoritativeQuoteOffer,
      id: "60000000-0000-4000-8000-000000000009:LOCKED-COMPLIANCE-TB:us-east-2",
      priceBookId: "60000000-0000-4000-8000-000000000009",
      sku: "LOCKED-COMPLIANCE-TB",
      label:
        "Fictional immutable storage capacity · LOCKED-COMPLIANCE-TB · us-east-2 · Compliance USD 2026 v2",
    } as const;
    const result = quotePayload(
      { ...validDraft, offer: otherOffer.label },
      accounts,
      [authoritativeQuoteOffer, otherOffer],
    );

    expect(result.payload.priceBookId).toBe(otherOffer.priceBookId);
    expect(result.payload.lines[0]).toMatchObject({
      sku: otherOffer.sku,
      region: otherOffer.region,
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
        scope: "120 TB",
        poNumber: "PO-NA-1092",
        quoteTitle: "Compliance replica renewal",
        quoteVersion: "2",
        serviceStart: "Aug 15, 2026",
        spend: "$55,440.00",
      }),
    ).toEqual({
      quote:
        "Compliance replica renewal · version 2 · issued; awaiting acceptance",
      agreement: "Cloud Service Agreement · version 3.2 · active",
      purchaseOrder: "PO-NA-1092",
      serviceStart: "Aug 15, 2026",
      commitment: "120 TB · $55,440.00 estimated annual spend",
    });
  });
});

it("rejects expiry at or before submission time, including a draft left open", () => {
  const expiry = new Date(validDraft.expiresAt);
  for (const delta of [0, 1, 60_000]) {
    expect(
      validateQuoteStage(
        2,
        validDraft,
        accounts,
        authoritativeQuoteOffers,
        new Date(expiry.getTime() + delta),
      ).expiresAt,
    ).toBe("Choose an expiry after the current time.");
  }
  expect(
    validateQuoteStage(
      2,
      validDraft,
      accounts,
      authoritativeQuoteOffers,
      new Date(expiry.getTime() - 60_000),
    ),
  ).toEqual({});
});
