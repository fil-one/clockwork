import { describe, expect, it } from "vitest";

import { derivePocPartnerAccountId, redactPartnerQuoteData } from ".";

const relationship = {
  partnerAccountId: "partner-1",
  endClientAccountId: "client-1",
  workload: "Archive evaluation",
  status: "approved" as const,
  protectionStartsAt: "2026-01-01T00:00:00.000Z",
  protectionEndsAt: "2027-01-01T00:00:00.000Z",
};

describe("POC partner relationship authority", () => {
  it("derives the partner from an effective approved relationship", () => {
    expect(
      derivePocPartnerAccountId({
        endClientAccountId: "client-1",
        workload: "archive evaluation",
        now: "2026-07-31T16:00:00.000Z",
        assertedPartnerAccountId: "partner-1",
        relationships: [relationship],
      }),
    ).toBe("partner-1");
  });

  it("rejects forged, expired, and ambiguous partner attribution", () => {
    expect(() =>
      derivePocPartnerAccountId({
        endClientAccountId: "client-1",
        workload: relationship.workload,
        now: "2026-07-31T16:00:00.000Z",
        assertedPartnerAccountId: "unrelated-partner",
        relationships: [relationship],
      }),
    ).toThrow("POC_PARTNER_RELATIONSHIP_FORGED");
    expect(
      derivePocPartnerAccountId({
        endClientAccountId: "client-1",
        workload: relationship.workload,
        now: "2028-01-01T00:00:00.000Z",
        assertedPartnerAccountId: null,
        relationships: [relationship],
      }),
    ).toBeUndefined();
    expect(() =>
      derivePocPartnerAccountId({
        endClientAccountId: "client-1",
        workload: relationship.workload,
        now: "2026-07-31T16:00:00.000Z",
        assertedPartnerAccountId: null,
        relationships: [
          relationship,
          { ...relationship, partnerAccountId: "partner-2" },
        ],
      }),
    ).toThrow("POC_PARTNER_RELATIONSHIP_AMBIGUOUS");
  });
});

describe("partner quote confidentiality", () => {
  const quote = {
    id: "quote-1",
    accountId: "client-1",
    partnerAccountId: "partner-1",
    totalMinor: "168000",
    partnerResaleTotalMinor: "216000",
    partnerDocumentId: "partner-only-document",
  };

  it("shows end clients only their legal price", () => {
    expect(
      redactPartnerQuoteData(quote, {
        isInternalStaff: false,
        accountIds: ["client-1"],
      }),
    ).toEqual({
      id: "quote-1",
      accountId: "client-1",
      partnerAccountId: "partner-1",
      totalMinor: "216000",
    });
  });

  it("preserves transfer economics for the persisted partner", () => {
    expect(
      redactPartnerQuoteData(quote, {
        isInternalStaff: false,
        accountIds: ["partner-1"],
      }),
    ).toEqual(quote);
  });

  it("fails closed when a resale quote has no end-client price yet", () => {
    expect(
      redactPartnerQuoteData(
        {
          ...quote,
          route: "resale",
          partnerResaleTotalMinor: null,
        },
        {
          isInternalStaff: false,
          accountIds: ["client-1"],
        },
      ),
    ).toEqual({
      id: "quote-1",
      accountId: "client-1",
      partnerAccountId: "partner-1",
      route: "resale",
    });
  });
});
