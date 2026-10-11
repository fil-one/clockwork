import { describe, expect, it } from "vitest";

import {
  PartnerDealInputSchema,
  PartnerInputSchema,
  PartnerListQuerySchema,
  addPartnerDays,
  partnerDealIsOpen,
  partnerListSearchParams,
  trimPartnerDecimal,
} from "./partners";

const id = "019a44ae-0000-7000-8000-00000000a001";
const partnerId = "019a44ae-0000-7000-8000-00000000a002";

describe("PartnerInputSchema", () => {
  it("needs only a name and fills every other field", () => {
    const parsed = PartnerInputSchema.parse({ id, name: "  Northwind  " });
    expect(parsed).toMatchObject({
      name: "Northwind",
      status: "prospect",
      models: [],
      ownerId: null,
      organizationId: null,
      contacts: [],
      nextStepDue: null,
      terms: {
        commissionPct: null,
        marginPct: null,
        currency: null,
        exclusivity: null,
        commissionSteps: [],
        rows: [],
      },
    });
  });

  it("reads empty form fields as not set", () => {
    const parsed = PartnerInputSchema.parse({
      id,
      name: "Northwind",
      ownerId: "",
      nextStepDue: "",
      terms: { commissionPct: "", currency: "", exclusivity: "" },
    });
    expect(parsed.ownerId).toBeNull();
    expect(parsed.nextStepDue).toBeNull();
    expect(parsed.terms).toMatchObject({
      commissionPct: null,
      currency: null,
      exclusivity: null,
    });
  });

  it.each(["0", "15", "17.5", "32.125", "100", "30%"])(
    "accepts a %s%% rate",
    (rate) => {
      expect(
        PartnerInputSchema.parse({
          id,
          name: "N",
          terms: { commissionPct: rate, marginPct: rate },
        }).terms.commissionPct,
      ).toBe(rate.replace("%", ""));
    },
  );

  it("stores one spelling per rate", () => {
    expect(
      PartnerInputSchema.parse({
        id,
        name: "N",
        terms: { commissionPct: "017.50", marginPct: "20.0" },
      }).terms,
    ).toMatchObject({ commissionPct: "17.5", marginPct: "20" });
  });

  it.each([
    ["100.01", "percent_range"],
    ["-5", "percent_format"],
    ["12.34567", "percent_format"],
    ["abc", "percent_format"],
  ])("refuses a %s rate", (rate, code) => {
    const result = PartnerInputSchema.safeParse({
      id,
      name: "N",
      terms: { commissionPct: rate },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(code);
  });

  it("keeps models in their listed order without repeats and refuses unknown ones", () => {
    expect(
      PartnerInputSchema.parse({
        id,
        name: "N",
        models: ["teaming", "referral", "teaming"],
      }).models,
    ).toEqual(["referral", "teaming"]);
    expect(
      PartnerInputSchema.safeParse({ id, name: "N", models: ["franchise"] })
        .success,
    ).toBe(false);
  });

  it("takes a step-down schedule in month order", () => {
    const steps = [
      { fromMonth: "1", ratePct: "30" },
      { fromMonth: "13", ratePct: "25" },
      { fromMonth: "25", ratePct: "20" },
    ];
    expect(
      PartnerInputSchema.parse({
        id,
        name: "N",
        terms: { commissionSteps: steps },
      }).terms.commissionSteps,
    ).toEqual([
      { fromMonth: 1, ratePct: "30" },
      { fromMonth: 13, ratePct: "25" },
      { fromMonth: 25, ratePct: "20" },
    ]);
    const unordered = PartnerInputSchema.safeParse({
      id,
      name: "N",
      terms: { commissionSteps: [steps[1], steps[0]] },
    });
    expect(unordered.error?.issues[0]?.message).toBe("steps_order");
  });

  it("lowercases contact email and allows a contact without one", () => {
    expect(
      PartnerInputSchema.parse({
        id,
        name: "N",
        contacts: [
          { name: "Ana", email: "Ana@Example.COM", role: "CEO" },
          { name: "Ben" },
        ],
      }).contacts,
    ).toEqual([
      { name: "Ana", email: "ana@example.com", role: "CEO" },
      { name: "Ben", email: "", role: "" },
    ]);
    expect(
      PartnerInputSchema.safeParse({
        id,
        name: "N",
        contacts: [{ name: "Ana", email: "not-an-address" }],
      }).success,
    ).toBe(false);
  });

  it("refuses control characters in single-line fields", () => {
    expect(
      PartnerInputSchema.safeParse({ id, name: "North\u0007wind" }).success,
    ).toBe(false);
    expect(
      PartnerInputSchema.parse({ id, name: "N", notes: "line one\r\nline two" })
        .notes,
    ).toBe("line one\nline two");
  });
});

describe("PartnerDealInputSchema", () => {
  const deal = {
    id,
    partnerId,
    endClient: "Acme, Inc.",
    registeredOn: "2026-10-10",
  };

  it("defaults to a registered referral with protection left to the policy", () => {
    expect(PartnerDealInputSchema.parse(deal)).toMatchObject({
      model: "referral",
      status: "registered",
      protectedUntil: null,
      estimatedSize: null,
      sizeUnit: null,
    });
  });

  it("needs a unit with a size and a protection date on or after registration", () => {
    expect(
      PartnerDealInputSchema.safeParse({ ...deal, estimatedSize: "250" }).error
        ?.issues[0]?.message,
    ).toBe("size_unit_required");
    expect(
      PartnerDealInputSchema.safeParse({
        ...deal,
        protectedUntil: "2026-10-09",
      }).error?.issues[0]?.message,
    ).toBe("protection_before_registration");
    expect(
      PartnerDealInputSchema.parse({
        ...deal,
        estimatedSize: "1,250.5",
        sizeUnit: "TiB",
        protectedUntil: "2026-10-10",
      }),
    ).toMatchObject({ estimatedSize: "1250.5", sizeUnit: "TiB" });
    expect(
      PartnerDealInputSchema.safeParse({
        ...deal,
        estimatedSize: "0",
        sizeUnit: "TB",
      }).success,
    ).toBe(false);
  });
});

describe("partner list query", () => {
  it("drops unknown filters instead of failing", () => {
    expect(
      PartnerListQuerySchema.parse({
        status: "bogus",
        model: ["resale", "other"],
        owner: "nope",
        mine: "1",
        due: "soon",
      }),
    ).toEqual({
      q: "",
      status: undefined,
      model: "resale",
      owner: undefined,
      mine: true,
      due: undefined,
    });
  });

  it("round-trips through the query string", () => {
    const query = PartnerListQuerySchema.parse({
      q: "north",
      status: "active",
      mine: "1",
      due: "overdue",
    });
    expect(partnerListSearchParams(query).toString()).toBe(
      "q=north&status=active&mine=1&due=overdue",
    );
  });
});

describe("partner helpers", () => {
  it("adds protection days across a month end", () => {
    expect(addPartnerDays("2026-10-10", 90)).toBe("2027-01-08");
  });

  it("trims stored decimals", () => {
    expect(trimPartnerDecimal("17.5000")).toBe("17.5");
    expect(trimPartnerDecimal("20.0000")).toBe("20");
    expect(trimPartnerDecimal("250")).toBe("250");
    expect(trimPartnerDecimal(null)).toBeNull();
  });

  it("treats a registration as open while it is protected", () => {
    expect(
      partnerDealIsOpen(
        { status: "registered", protectedUntil: "2026-10-10" },
        "2026-10-10",
      ),
    ).toBe(true);
    expect(
      partnerDealIsOpen(
        { status: "disputed", protectedUntil: "2026-10-09" },
        "2026-10-10",
      ),
    ).toBe(false);
    expect(
      partnerDealIsOpen(
        { status: "won", protectedUntil: "2027-01-01" },
        "2026-10-10",
      ),
    ).toBe(false);
  });
});
