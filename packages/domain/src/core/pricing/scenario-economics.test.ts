import { describe, expect, it } from "vitest";

import type { Money, PricingPartnerEconomics } from "@clockwork/contracts";

import { indicativeLinePrice, indicativeScenarioPrice } from "./index";
import {
  convertCapacity,
  resaleTerms,
  scenarioPartnerEconomics,
} from "./scenario-economics";

const usd = (minor: string) => ({ currency: "USD", minor }) as Money;
const list = usd("599");
/** 10 PiB in decimal TB, as the builder stores it. */
const tenPiB = "11258.99906842624";

describe("capacity units", () => {
  it("converts binary and decimal units to decimal TB exactly", () => {
    expect(convertCapacity("10", "PiB", "TB")).toBe(tenPiB);
    expect(convertCapacity("1", "TiB", "TB")).toBe("1.099511627776");
    expect(convertCapacity("2.5", "PB", "TB")).toBe("2500");
    expect(convertCapacity("0.000001", "PiB", "TB")).toBe(
      "0.001125899906842624",
    );
    expect(convertCapacity("500", "TB", "TB")).toBe("500");
  });

  it("refuses a conversion it cannot state exactly", () => {
    // 1 TB is 0.9094947017729282379150390625 TiB: 28 decimal places.
    expect(convertCapacity("1", "TB", "TiB")).toBeNull();
    expect(convertCapacity("1", "EB", "TB")).toBeNull();
  });

  it("prices 10 PiB at $5.99 per TB-month: about $67.4K a month", () => {
    const priced = indicativeLinePrice({
      unitPrice: list,
      minimumQuantity: "1",
      quantity: tenPiB,
      termMonths: 36,
      discountBps: 0,
    });
    // 11,258.99906842624 x 5.99 = 67,441.4044198731776.
    expect(priced.monthly).toEqual(usd("6744140"));
    expect(priced.annual).toEqual(usd("80929685"));
    expect(priced.total).toEqual(usd("242789056"));
  });
});

describe("scenario totals", () => {
  it("adds monthly run rates and first years across lines", () => {
    const priced = indicativeScenarioPrice([
      {
        unitPrice: list,
        minimumQuantity: "1",
        quantity: "1000",
        termMonths: 12,
        discountBps: 0,
      },
      {
        unitPrice: list,
        minimumQuantity: "1",
        quantity: "333.333333",
        termMonths: 6,
        discountBps: 1_000,
      },
    ]);
    // 5.99 x 1,000 = 5,990.00; 5.39 x 333.333333 = 1,796.666665 -> 1,796.67.
    expect(priced.monthly).toEqual(usd("778667"));
    // 71,880.00 for a year, plus the six-month line's whole term:
    // 5.39 x 333.333333 x 6 = 10,779.99998922 -> 10,780.00.
    expect(priced.annual).toEqual(usd("8266000"));
  });
});

describe("resale terms", () => {
  it("derives the buy price from a margin and the margin from a buy price", () => {
    expect(
      resaleTerms({ customerPriceMinor: "650", marginBps: 3_200 }),
    ).toEqual({
      customerPriceMinor: 650n,
      buyPriceMinor: 442n,
      marginBps: 3_200,
    });
    expect(
      resaleTerms({ customerPriceMinor: "650", buyPriceMinor: "442" }),
    ).toEqual({
      customerPriceMinor: 650n,
      buyPriceMinor: 442n,
      marginBps: 3_200,
    });
    // 2.10 / 6.50 = 32.307...%, rounded to 32.31%.
    expect(
      resaleTerms({ customerPriceMinor: "650", buyPriceMinor: "440" })
        .marginBps,
    ).toBe(3_231);
    // A buy price above the customer price is a negative margin, shown as is.
    expect(
      resaleTerms({ customerPriceMinor: "500", buyPriceMinor: "599" })
        .marginBps,
    ).toBe(-1_980);
    expect(
      resaleTerms({ customerPriceMinor: "0", buyPriceMinor: "0" }).marginBps,
    ).toBeNull();
  });
});

const line = (quantity: string, termMonths: number, discountBps = 0) => ({
  unitPrice: list,
  minimumQuantity: "1",
  quantity,
  termMonths,
  discountBps,
});

describe("partner economics", () => {
  it("steps a referral commission down over 36 months and reconciles to the cent", () => {
    const referral: PricingPartnerEconomics = {
      model: "referral",
      commissionBps: 3_000,
      steps: [
        { fromMonth: 13, commissionBps: 2_000 },
        { fromMonth: 25, commissionBps: 1_000 },
      ],
    };
    const lines = [line(tenPiB, 36)];
    const result = scenarioPartnerEconomics(lines, referral);
    expect(result.months).toBe(36);
    // 6,744,140.44 x 30% = 2,023,242.13 cents in month 1.
    expect(result.firstMonth).toEqual({
      customerSpend: usd("6744140"),
      partnerEarnings: usd("2023242"),
      filOneNet: usd("4720898"),
    });
    expect(
      result.periods.map((period) => [
        period.fromMonth,
        period.toMonth,
        period.commissionBps,
      ]),
    ).toEqual([
      [1, 12, 3_000],
      [13, 24, 2_000],
      [25, 36, 1_000],
    ]);
    // Per TB-month: $5.99 at 30%, 20% and 10%.
    expect(
      result.periods.map((period) => period.perUnit.partnerEarnings),
    ).toEqual([usd("180"), usd("120"), usd("60")]);
    expect(result.periods[0]?.perUnit.filOneNet).toEqual(usd("419"));
    expect(result.years.map((year) => year.partnerEarnings)).toEqual([
      usd("24278906"),
      usd("16185937"),
      usd("8092968"),
    ]);
    expect(result.firstYear).toEqual(result.years[0]);
    // Years add to the term, and the term's spend is the scenario total.
    expect(result.term.partnerEarnings).toEqual(usd("48557811"));
    expect(result.term.customerSpend).toEqual(
      indicativeScenarioPrice(lines).total,
    );
    const sum = (key: "customerSpend" | "partnerEarnings" | "filOneNet") =>
      result.years.reduce((total, year) => total + BigInt(year[key].minor), 0n);
    for (const key of [
      "customerSpend",
      "partnerEarnings",
      "filOneNet",
    ] as const)
      expect(sum(key).toString()).toBe(result.term[key].minor);
    expect(
      BigInt(result.term.customerSpend.minor) -
        BigInt(result.term.partnerEarnings.minor),
    ).toBe(BigInt(result.term.filOneNet.minor));
  });

  it("prices a resale at the partner's price and Fil One's price to the partner", () => {
    const result = scenarioPartnerEconomics([line("500", 36)], {
      model: "resale",
      customerPriceMinor: "650",
      marginBps: 3_200,
    });
    expect(result.resale).toEqual({
      customerPrice: usd("650"),
      buyPrice: usd("442"),
      marginBps: 3_200,
    });
    // 500 TB: the customer pays 3,250.00, Fil One 2,210.00, the partner keeps 1,040.00.
    expect(result.firstMonth).toEqual({
      customerSpend: usd("325000"),
      partnerEarnings: usd("104000"),
      filOneNet: usd("221000"),
    });
    expect(result.firstYear.partnerEarnings).toEqual(usd("1248000"));
    expect(result.term.filOneNet).toEqual(usd("7956000"));
    expect(result.periods).toHaveLength(1);
    expect(result.periods[0]?.perUnit).toEqual({
      customerSpend: usd("650"),
      partnerEarnings: usd("208"),
      filOneNet: usd("442"),
    });
  });

  it("follows lines that end before the longest term", () => {
    const result = scenarioPartnerEconomics(
      [line("1000", 24), line("1000", 12)],
      { model: "referral", commissionBps: 1_500, steps: [] },
    );
    expect(
      result.periods.map((period) => [period.fromMonth, period.toMonth]),
    ).toEqual([
      [1, 12],
      [13, 24],
    ]);
    // 2 x 5,990.00 x 15% in months 1-12, then one line.
    expect(result.periods[0]?.monthly.partnerEarnings).toEqual(usd("179700"));
    expect(result.periods[1]?.monthly.partnerEarnings).toEqual(usd("89850"));
    expect(result.years[1]?.customerSpend).toEqual(usd("7188000"));
  });

  it("adds a share, a fee per unit and a fixed monthly amount for other models", () => {
    const result = scenarioPartnerEconomics([line("1000", 12)], {
      model: "other",
      partnerShareBps: 500,
      partnerPerUnitMinor: "10",
      partnerMonthlyMinor: "50000",
    });
    // 5% of 5,990.00 + 0.10 x 1,000 + 500.00 = 899.50.
    expect(result.firstMonth.partnerEarnings).toEqual(usd("89950"));
    expect(result.firstMonth.filOneNet).toEqual(usd("509050"));
    // Per TB: 0.2995 + 0.10 + 0.50 = 0.8995, rounded to 0.90.
    expect(result.periods[0]?.perUnit.partnerEarnings).toEqual(usd("90"));
    expect(result.term.partnerEarnings).toEqual(usd("1079400"));
  });

  it("applies the entered discount before any partner share", () => {
    const result = scenarioPartnerEconomics([line("100", 12, 1_000)], {
      model: "referral",
      commissionBps: 2_000,
      steps: [],
    });
    // 5.99 less 10% = 5.39; 539.00 a month, 20% of it 107.80.
    expect(result.firstMonth.customerSpend).toEqual(usd("53900"));
    expect(result.firstMonth.partnerEarnings).toEqual(usd("10780"));
  });
});
