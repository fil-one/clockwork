import { describe, expect, it } from "vitest";

import {
  addContractMonths,
  contractDaysBetween,
  contractTermBoundary,
  contractTermSchedule,
  type ContractTerm,
} from "./contract-terms";

const term = (patch: Partial<ContractTerm>): ContractTerm => ({
  effectiveDate: "2026-01-15",
  initialTermMonths: 12,
  autoRenew: false,
  renewalTermMonths: null,
  noticePeriodDays: null,
  ...patch,
});

describe("addContractMonths", () => {
  it.each([
    ["2024-01-31", 1, "2024-02-29"],
    ["2025-01-31", 1, "2025-02-28"],
    ["2024-02-29", 12, "2025-02-28"],
    ["2024-02-29", 48, "2028-02-29"],
    ["2026-08-31", 1, "2026-09-30"],
    ["2026-12-31", 2, "2027-02-28"],
    ["2026-03-15", 0, "2026-03-15"],
  ])("%s + %i months = %s", (date, months, expected) => {
    expect(addContractMonths(date, months)).toBe(expected);
  });

  it("rejects dates that do not exist", () => {
    expect(() => addContractMonths("2026-02-30", 1)).toThrow(
      "CONTRACT_DATE_INVALID",
    );
  });
});

describe("contractTermBoundary", () => {
  it("has no boundary without an effective date and term", () => {
    expect(
      contractTermBoundary(term({ effectiveDate: null }), "2026-10-04"),
    ).toBeNull();
    expect(
      contractTermBoundary(term({ initialTermMonths: null }), "2026-10-04"),
    ).toBeNull();
  });

  it("keeps a fixed term's expiry even after it has passed", () => {
    expect(contractTermBoundary(term({}), "2030-01-01")).toBe("2027-01-15");
  });

  it("rolls an auto-renewing term forward from the effective date without drift", () => {
    const monthly = term({
      effectiveDate: "2026-01-31",
      initialTermMonths: 1,
      autoRenew: true,
      renewalTermMonths: 1,
    });
    expect(contractTermBoundary(monthly, "2026-02-27")).toBe("2026-02-28");
    // On the boundary itself the next term has started.
    expect(contractTermBoundary(monthly, "2026-02-28")).toBe("2026-03-31");
    expect(contractTermBoundary(monthly, "2026-04-01")).toBe("2026-04-30");
    expect(contractTermBoundary(monthly, "2026-05-01")).toBe("2026-05-31");
  });

  it("renews leap-day contracts on the last day of February", () => {
    const annual = term({
      effectiveDate: "2024-02-29",
      autoRenew: true,
      renewalTermMonths: 12,
    });
    expect(contractTermBoundary(annual, "2024-03-01")).toBe("2025-02-28");
    expect(contractTermBoundary(annual, "2026-10-04")).toBe("2027-02-28");
    expect(contractTermBoundary(annual, "2027-03-01")).toBe("2028-02-29");
  });

  it("uses a renewal term that differs from the initial term", () => {
    const threeThenOne = term({
      effectiveDate: "2023-07-01",
      initialTermMonths: 36,
      autoRenew: true,
      renewalTermMonths: 12,
    });
    expect(contractTermBoundary(threeThenOne, "2026-06-30")).toBe("2026-07-01");
    expect(contractTermBoundary(threeThenOne, "2026-07-01")).toBe("2027-07-01");
    expect(contractTermBoundary(threeThenOne, "2040-01-01")).toBe("2040-07-01");
  });
});

describe("contractTermSchedule", () => {
  it("reports the last day of the term and the notice deadline before it", () => {
    expect(
      contractTermSchedule(
        term({
          effectiveDate: "2026-01-01",
          autoRenew: true,
          renewalTermMonths: 12,
          noticePeriodDays: 60,
        }),
        "2026-10-04",
      ),
    ).toEqual({
      termEndDate: "2026-12-31",
      renewalDate: "2027-01-01",
      noticeDeadline: "2026-11-01",
    });
  });

  it("crosses a leap day when counting notice days back", () => {
    expect(
      contractTermSchedule(
        term({
          effectiveDate: "2023-03-31",
          autoRenew: true,
          renewalTermMonths: 12,
          noticePeriodDays: 30,
        }),
        "2024-01-10",
      ).noticeDeadline,
    ).toBe("2024-02-29");
  });

  it("gives a fixed-term contract an end date but no renewal or notice deadline", () => {
    expect(
      contractTermSchedule(term({ noticePeriodDays: 30 }), "2026-10-04"),
    ).toEqual({
      termEndDate: "2027-01-14",
      renewalDate: null,
      noticeDeadline: null,
    });
  });

  it("counts a zero-day notice period as the last day of the term", () => {
    expect(
      contractTermSchedule(
        term({ autoRenew: true, renewalTermMonths: 12, noticePeriodDays: 0 }),
        "2026-10-04",
      ).noticeDeadline,
    ).toBe("2027-01-14");
  });
});

it("counts whole days across month and year ends", () => {
  expect(contractDaysBetween("2026-12-31", "2027-01-30")).toBe(30);
  expect(contractDaysBetween("2024-03-01", "2024-02-28")).toBe(-2);
});
