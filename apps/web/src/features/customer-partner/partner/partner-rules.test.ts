import { describe, expect, it } from "vitest";

import { translatorFor } from "@/src/i18n/catalogs";

import { merchantOfRecord } from "@clockwork/domain/core";

import {
  attributionStatement,
  currentPartnerRole,
  partnerRoleSummary,
  registrationCreditLabel,
  renewalReviewSummary,
  roleCanUseSurface,
  validPartnerQuoteActions,
  type AttributionRoute,
} from "./partner-rules";

const attributionCases: readonly [
  AttributionRoute,
  string,
  "Fil One" | "Aurora Systems" | "The marketplace",
][] = [
  ["direct", "No partner attribution applies", "Fil One"],
  ["referral", "Aurora Systems is the sourced partner", "Fil One"],
  ["resale", "Aurora Systems is the sourced partner", "Aurora Systems"],
  ["distributor", "Aurora Systems is the sourced partner", "Aurora Systems"],
  ["marketplace", "No partner attribution applies", "The marketplace"],
];

describe("structural partner attribution", () => {
  it.each(attributionCases)(
    "derives the %s statement and merchant from enforced route truth",
    (route, credit, merchantName) => {
      const statement = attributionStatement(
        route,
        "Aurora Systems",
        translatorFor("en"),
      );
      expect(statement).toContain(credit);
      expect(statement).toContain(`${merchantName} is the merchant of record.`);
      expect(merchantOfRecord(route)).toBe(
        merchantName === "Fil One"
          ? "fil_one"
          : merchantName === "Aurora Systems"
            ? "partner"
            : "marketplace",
      );
    },
  );

  it("claims sourced credit only for the accepted projection of an approved registration", () => {
    const t = translatorFor("en");
    expect(t(registrationCreditLabel("accepted"))).toBe("Attribution: sourced");
    expect(t(registrationCreditLabel("pending"))).toBe(
      "Attribution: decision pending",
    );
    for (const status of [
      "active",
      "attention",
      "draft",
      "open",
      "canceled",
      "paid",
      "blocked",
      "complete",
    ] as const) {
      expect(t(registrationCreditLabel(status))).toBe(
        "Attribution: no sourced credit recorded",
      );
    }
  });
});

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
    expect(
      partnerRoleSummary("partner_seller", translatorFor("en")).join(" "),
    ).toContain("Cannot view partner billing");
    // The same rule, stated in the reader's language rather than English.
    expect(
      partnerRoleSummary("partner_seller", translatorFor("de")).join(" "),
    ).toContain("Provisionen");
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
    const summary = renewalReviewSummary(
      {
        client: "Halcyon Research Cooperative",
        action: "renew",
        currentEnd: "December 31, 2026",
        requestedMonths: 12,
        transferPrice: "$91,200 annually",
        resalePrice: "$112,000 annually",
        merchantOfRecord: "Meridian Channel Group",
      },
      translatorFor("en"),
    ).join(" ");
    expect(summary).toContain("Halcyon Research Cooperative");
    expect(summary).toContain("Fil One transfer price");
    expect(summary).toContain("Partner resale price");
    expect(summary).toContain("Merchant of record");
  });
});
