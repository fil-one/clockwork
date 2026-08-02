import { describe, expect, it } from "vitest";

import {
  currentPartnerRole,
  partnerRoleSummary,
  renewalReviewSummary,
  roleCanUseSurface,
  validPartnerQuoteActions,
} from "./partner-rules";

describe("partner role behavior", () => {
  it("prefers partner_admin when multiple partner roles exist", () => {
    expect(currentPartnerRole(["partner_seller", "partner_admin"])).toBe(
      "partner_admin",
    );
  });

  it("keeps seller access out of financial and renewal surfaces", () => {
    expect(roleCanUseSurface(["partner_seller"], ["partner_admin"])).toBe(
      false,
    );
    expect(
      roleCanUseSurface(
        ["partner_seller"],
        ["partner_admin", "partner_seller"],
      ),
    ).toBe(true);
    expect(partnerRoleSummary("partner_seller").join(" ")).toContain(
      "Cannot view partner billing",
    );
  });
});

describe("valid partner quote actions", () => {
  it("uses draft, open, accepted, and canceled action language", () => {
    expect(validPartnerQuoteActions("draft", "partner_seller")).toEqual([
      "edit",
      "issue",
      "cancel",
    ]);
    expect(validPartnerQuoteActions("open", "partner_admin")).toEqual([
      "cancel",
      "revise",
      "download",
    ]);
    expect(validPartnerQuoteActions("accepted", "partner_admin")).toEqual([
      "download",
    ]);
    expect(validPartnerQuoteActions("canceled", "partner_seller")).toEqual([]);
    expect(validPartnerQuoteActions("canceled", "partner_admin")).toEqual([
      "revise",
    ]);
  });
});

describe("renewal review summary", () => {
  it("puts end client, price boundaries, term, and merchant of record in review", () => {
    const summary = renewalReviewSummary({
      client: "Halcyon Research Cooperative",
      action: "renew",
      currentEnd: "December 31, 2026",
      requestedMonths: 12,
      transferPrice: "$91,200 annually",
      resalePrice: "$112,000 annually",
      merchantOfRecord: "Meridian Channel Group",
    }).join(" ");
    expect(summary).toContain("Halcyon Research Cooperative");
    expect(summary).toContain("Fil One transfer price");
    expect(summary).toContain("Partner resale price");
    expect(summary).toContain("Merchant of record");
  });
});
