import { describe, expect, it } from "vitest";

import { translatorFor } from "@/src/i18n/catalogs";

import {
  defaultQuoteExpiry,
  emptyResaleQuoteDraft,
  merchantOfRecordName,
  parseDecimalAmount,
  partnerRouteConsequence,
  quotableOffers,
  quoteExpiryLeadDays,
  quoteReviewSummary,
  resaleQuotePayload,
  resolveSelectorId,
  validateResaleQuoteStage,
  type PartnerQuoteContext,
  type ResaleQuoteDraft,
} from "./resale-quote-model";

/**
 * The release suites pin the whole process clock through `CLOCKWORK_TEST_CLOCK`
 * (`scripts/release-suites.mjs`), so that clock is honoured when it is set. It
 * is only ever the first clock these cases run against: a default derived from
 * the current time has to hold at any clock, so every case below also runs past
 * `2026-08-31T17:00`, the expiry this form used to ship as a literal, and past
 * the release clock of `2026-07-31`.
 */
const pinnedClock = new Date(
  process.env.CLOCKWORK_TEST_CLOCK ?? "2026-08-15T12:00:00.000Z",
);
const firstLapsedDay = new Date("2026-09-01T00:00:01.000Z");
const nextYear = new Date("2027-11-19T23:45:00.000Z");
const fiveYearsOn = new Date("2031-02-28T08:00:00.000Z");
const clocks = [pinnedClock, firstLapsedDay, nextYear, fiveYearsOn];

const usdBook = "1a2b3c4d-1111-4111-8111-111111111111";
const eurBook = "1a2b3c4d-2222-4222-8222-222222222222";

const usdOffer = {
  id: `${usdBook}:LOCKED-STORAGE-TB:us-east-2`,
  name: "LOCKED-STORAGE-TB · us-east-2 · Demo USD 2026 (USD)",
  priceBookId: usdBook,
  sku: "LOCKED-STORAGE-TB",
  region: "us-east-2",
  currency: "USD",
};
const eurOffer = {
  id: `${eurBook}:LOCKED-STORAGE-TB:eu-west-1`,
  name: "LOCKED-STORAGE-TB · eu-west-1 · Demo EUR 2026 (EUR)",
  priceBookId: eurBook,
  sku: "LOCKED-STORAGE-TB",
  region: "eu-west-1",
  currency: "EUR",
};
const halcyon = {
  id: "5e6f7a8b-1111-4111-8111-111111111111",
  name: "Halcyon Research Cooperative",
  quoteCurrency: "EUR",
};
const solace = {
  id: "5e6f7a8b-2222-4222-8222-222222222222",
  name: "Solace Public Records",
  quoteCurrency: "EUR",
};

const context: PartnerQuoteContext = {
  partnerAccountId: "8f6bb5c6-4f0a-4a2b-9f2d-4c0f1c9b7d31",
  partnerAccountName: "Blue Harbor MSP",
  route: "resale",
  offers: [usdOffer, eurOffer],
  endClients: [halcyon, solace],
};

function completedDraft(now: Date): ResaleQuoteDraft {
  return {
    ...emptyResaleQuoteDraft(now),
    offerName: eurOffer.name,
    capacity: "120",
    termMonths: "12",
    endClientName: halcyon.name,
    resalePrice: "68400",
  };
}

describe("human-readable partner quote selectors", () => {
  it("resolves names case-insensitively to the acting partner's own IDs", () => {
    expect(resolveSelectorId(usdOffer.name.toUpperCase(), context.offers)).toBe(
      usdOffer.id,
    );
    expect(resolveSelectorId(solace.name, context.endClients)).toBe(solace.id);
    expect(resolveSelectorId(halcyon.id, context.endClients)).toBeUndefined();
  });

  it("refuses a name that belongs to another partner's client list", () => {
    const errors = validateResaleQuoteStage(
      2,
      { ...completedDraft(pinnedClock), endClientName: "Atlas Field Imaging" },
      context,
      pinnedClock,
    );
    expect(errors.endClientName).toEqual({
      id: "partner.quote.new.error.endClient",
    });
  });

  it("offers only the books that can price the named client's quote", () => {
    expect(quotableOffers(context, halcyon.name)).toEqual([eurOffer]);
    // Before a client is named nothing is excluded.
    expect(quotableOffers(context, "")).toEqual(context.offers);
  });
});

describe("the draft an untouched form starts from", () => {
  it("names no end client, no offer, and no price", () => {
    const draft = emptyResaleQuoteDraft(pinnedClock);
    expect(draft.offerName).toBe("");
    expect(draft.endClientName).toBe("");
    expect(draft.capacity).toBe("");
    expect(draft.termMonths).toBe("");
    expect(draft.resalePrice).toBe("");
  });

  for (const now of clocks) {
    it(`expires after the current time at ${now.toISOString()}`, () => {
      const draft = emptyResaleQuoteDraft(now);
      // The lapse this replaces: a fixed 2026-08-31T17:00 default failed
      // stage-2 validation on its first submission from 2026-09-01 onward.
      expect(Date.parse(draft.expiresAt)).toBeGreaterThan(now.getTime());
      expect(draft.expiresAt).not.toContain("2026-08-31");
      expect(
        validateResaleQuoteStage(3, completedDraft(now), context, now),
      ).toEqual({});
    });
  }

  it("offsets the derived expiry by the stated lead time", () => {
    const expiry = new Date(defaultQuoteExpiry(nextYear));
    expect(
      Math.round((expiry.getTime() - nextYear.getTime()) / 86_400_000),
    ).toBe(quoteExpiryLeadDays);
  });

  it("formats the derived expiry as the local value the input round-trips", () => {
    expect(defaultQuoteExpiry(new Date(2027, 0, 2, 9, 5))).toBe(
      "2027-02-01T09:05",
    );
  });
});

describe("partner quote workflow validation", () => {
  it("validates only the first stage before advancing", () => {
    expect(
      validateResaleQuoteStage(
        1,
        { ...completedDraft(pinnedClock), capacity: "0" },
        context,
        pinnedClock,
      ),
    ).toEqual({});
  });

  it("identifies every invalid commercial field at review", () => {
    const errors = validateResaleQuoteStage(
      3,
      {
        ...completedDraft(pinnedClock),
        capacity: "9",
        termMonths: "1.5",
        endClientName: "Unknown",
        expiresAt: "2026-01-01T00:00:00Z",
        resalePrice: "0",
      },
      context,
      pinnedClock,
    );
    expect(Object.keys(errors)).toEqual([
      "capacity",
      "termMonths",
      "endClientName",
      "expiresAt",
      "resalePrice",
    ]);
  });

  it("refuses a price book in a currency the end client is not billed in", () => {
    const errors = validateResaleQuoteStage(
      2,
      { ...completedDraft(pinnedClock), offerName: usdOffer.name },
      context,
      pinnedClock,
    );
    expect(errors.offerName).toEqual({
      id: "partner.quote.new.error.currency",
      values: { currency: "EUR", client: halcyon.name },
    });
    const problem = errors.offerName;
    expect(problem ? translatorFor("en")(problem.id, problem.values) : "").toBe(
      `Select an offer priced in EUR, the billing currency for ${halcyon.name}.`,
    );
  });

  it("asks a referral partner for no price it is not allowed to set", () => {
    const referral = { ...context, route: "referral" as const };
    const errors = validateResaleQuoteStage(
      3,
      { ...completedDraft(pinnedClock), resalePrice: "" },
      referral,
      pinnedClock,
    );
    expect(errors).toEqual({});
    expect(merchantOfRecordName(referral)).toBe("Fil One");
  });

  it("describes resale and distributor routes from their enforced merchant and tier rules", () => {
    const t = translatorFor("en");
    expect(t(partnerRouteConsequence("resale"))).toContain(
      "partner is merchant of record",
    );
    expect(t(partnerRouteConsequence("resale"))).toContain(
      "saved transfer tier",
    );
    expect(t(partnerRouteConsequence("distributor"))).toContain(
      "saved transfer tier is distributor",
    );
    expect(t(partnerRouteConsequence("distributor"))).toContain(
      "partner as merchant of record",
    );
  });

  it("creates a review summary stating the acting partner as merchant of record", () => {
    const summary = quoteReviewSummary(
      completedDraft(pinnedClock),
      context,
      translatorFor("en"),
      "en-US",
    ).join(" ");
    expect(summary).toContain("Partner resale price: €68,400.00");
    expect(summary).toContain("binding transfer price");
    expect(summary).toContain(halcyon.name);
    expect(summary).toContain("Merchant of record: Blue Harbor MSP");
    expect(summary).toContain("LOCKED-STORAGE-TB");
    expect(summary).toContain("eu-west-1");
  });
});

describe("the command payload", () => {
  it("carries the session's partner account, its route, and the selected rate card", () => {
    const payload = resaleQuotePayload(completedDraft(pinnedClock), context);
    expect(payload.partnerAccountId).toBe(context.partnerAccountId);
    expect(payload.priceBookId).toBe(eurBook);
    expect(payload.endClientAccountId).toBe(halcyon.id);
    expect(payload.route).toBe("resale");
    // The rate card the offer resolved to. A literal SKU or region the book
    // does not carry is answered with "No active rate for <sku>/<region>",
    // which reaches the seller as a 500.
    expect(payload.lines[0]).toMatchObject({
      sku: "LOCKED-STORAGE-TB",
      region: "eu-west-1",
      quantity: "120",
      termMonths: 12,
    });
    // Currency comes from the selected price book, not from a substring of
    // whatever the seller typed into the offer field.
    expect(payload.partnerResaleTotal?.currency).toBe("EUR");
    // The transfer tier is the repository's to read from the persisted
    // partner; asserting one here could only ever contradict it.
    expect(payload).not.toHaveProperty("partnerTier");
  });

  it("sends no partner price on a referral, which the command rejects", () => {
    const payload = resaleQuotePayload(
      { ...completedDraft(pinnedClock), resalePrice: "" },
      { ...context, route: "referral" },
    );
    expect(payload.route).toBe("referral");
    expect(payload).not.toHaveProperty("partnerResaleTotal");
  });

  it("refuses to build a payload from an unresolved selector", () => {
    expect(() =>
      resaleQuotePayload(
        { ...completedDraft(pinnedClock), offerName: "Someone else's book" },
        context,
      ),
    ).toThrow("Quote selectors have not been resolved.");
  });

  it("refuses to build a payload the server would reject on currency", () => {
    expect(() =>
      resaleQuotePayload(
        { ...completedDraft(pinnedClock), offerName: usdOffer.name },
        context,
      ),
    ).toThrow("Quote currency does not match the end client.");
  });
});

describe("a resale price as a seller types it", () => {
  it("reads the decimal mark the seller's language uses", () => {
    expect(parseDecimalAmount("68400")).toBe(68400);
    expect(parseDecimalAmount("68400.5")).toBe(68400.5);
    expect(parseDecimalAmount("68400,50")).toBe(68400.5);
    expect(parseDecimalAmount("68.400,50")).toBe(68400.5);
    expect(parseDecimalAmount("68,400.50")).toBe(68400.5);
    expect(parseDecimalAmount("68\u202f400,50")).toBe(68400.5);
    expect(parseDecimalAmount("68.400")).toBe(68400);
  });

  it("refuses text that is not one amount", () => {
    for (const input of ["", "abc", "-5", "1,2,3", "12.345,678", "1e5"])
      expect(parseDecimalAmount(input), input).toBeUndefined();
  });

  it("accepts a German seller's price where a bare Number() refused it", () => {
    const errors = validateResaleQuoteStage(
      3,
      { ...completedDraft(pinnedClock), resalePrice: "68.400,00" },
      context,
      pinnedClock,
    );
    expect(errors.resalePrice).toBeUndefined();
    expect(
      resaleQuotePayload(
        { ...completedDraft(pinnedClock), resalePrice: "68.400,00" },
        context,
      ).partnerResaleTotal?.minor,
    ).toBe("6840000");
  });
});
