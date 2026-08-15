import { describe, expect, it } from "vitest";

import {
  dealRegistrationPayload,
  emptyDealRegistrationDraft,
  resolveEndClient,
  validateDealRegistration,
  type DealRegistrationContext,
} from "./deal-registration-model";

const context: DealRegistrationContext = {
  partnerAccountId: "10000000-0000-4000-8000-000000000002",
  partnerAccountName: "Redwood Channel Group",
  endClients: [
    { id: "10000000-0000-4000-8000-000000000004", name: "Juniper Health Demo" },
    {
      id: "10000000-0000-4000-8000-000000000002",
      name: "Redwood Channel Group",
    },
  ],
};

function draft(
  overrides: Partial<ReturnType<typeof emptyDealRegistrationDraft>> = {},
) {
  return {
    ...emptyDealRegistrationDraft(),
    endClientName: "Juniper Health Demo",
    workload: "Immutable archive expansion",
    expectedVolume: "120",
    ...overrides,
  };
}

describe("deal registration draft", () => {
  it("seeds no commercial claim the seller did not make", () => {
    const empty = emptyDealRegistrationDraft();
    expect(empty.endClientName).toBe("");
    expect(empty.workload).toBe("");
    expect(empty.expectedVolume).toBe("");
    // The one seeded value is the program guide's default window, which is a
    // policy default rather than a claim about this opportunity.
    expect(empty.protectionDays).toBe("90");
  });

  it("accepts a registration whose end client the partner may name", () => {
    expect(validateDealRegistration(draft(), context)).toEqual({});
  });

  /**
   * The deleted workflow-panel branch defaulted this field to the literal
   * string `120 TB`. `QuantitySchema` -- which the command parses the payload
   * with -- is `^(0|[1-9]\d{0,19})(\.\d{1,18})?$`, so every untouched
   * submission of that form was refused by the server for a value the form
   * itself supplied.
   */
  it("refuses an expected volume carrying a unit, as the command does", () => {
    expect(
      validateDealRegistration(draft({ expectedVolume: "120 TB" }), context)
        .expectedVolume,
    ).toContain("no unit");
    expect(
      validateDealRegistration(draft({ expectedVolume: "120.5" }), context),
    ).toEqual({});
  });

  it("refuses an end client that is not in the partner's own list", () => {
    expect(
      validateDealRegistration(
        draft({ endClientName: "Somebody Else Ltd" }),
        context,
      ).endClientName,
    ).toBe("Select one of your named end clients by name.");
  });

  /** `registerDeal` throws "Partner cannot register itself as end client". */
  it("refuses the partner's own account as its end client", () => {
    expect(
      validateDealRegistration(
        draft({ endClientName: "Redwood Channel Group" }),
        context,
      ).endClientName,
    ).toContain("cannot register itself");
  });

  it("refuses a protection window that is not a positive whole day count", () => {
    for (const protectionDays of ["0", "-1", "1.5", ""])
      expect(
        validateDealRegistration(draft({ protectionDays }), context)
          .protectionDays,
      ).toContain("at least one whole day");
  });

  it("requires a described workload", () => {
    expect(
      validateDealRegistration(draft({ workload: "   " }), context).workload,
    ).toContain("Describe the workload");
  });

  it("matches an end client by name without regard to case or padding", () => {
    expect(
      resolveEndClient("  juniper health demo ", context.endClients)?.id,
    ).toBe("10000000-0000-4000-8000-000000000004");
    expect(resolveEndClient("", context.endClients)).toBeUndefined();
  });
});

describe("deal registration payload", () => {
  it("carries the resolved account identifiers rather than typed text", () => {
    expect(dealRegistrationPayload(draft(), context)).toEqual({
      partnerAccountId: "10000000-0000-4000-8000-000000000002",
      endClientAccountId: "10000000-0000-4000-8000-000000000004",
      workload: "Immutable archive expansion",
      expectedVolume: "120",
      protectionDays: 90,
    });
  });

  /**
   * The deleted panel branch sent `houseAccountIds: []`. The repository derives
   * house accounts and prior deals from the unified account records and ignores
   * the field -- "a command caller cannot attest its own exclusion result" --
   * so sending it stated an exclusion check the client never performed.
   */
  it("attests no exclusion result of its own", () => {
    expect(dealRegistrationPayload(draft(), context)).not.toHaveProperty(
      "houseAccountIds",
    );
  });

  it("refuses to compose a payload for an unresolvable end client", () => {
    expect(() =>
      dealRegistrationPayload(draft({ endClientName: "Nobody" }), context),
    ).toThrow(/not one this partner may name/);
  });
});
