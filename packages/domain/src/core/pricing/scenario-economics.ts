import type {
  Currency,
  Money,
  PricingPartnerEconomics,
} from "@clockwork/contracts";

import {
  QUANTITY_SCALE,
  divideRound,
  formatDecimal,
  parseDecimal,
} from "../decimal";
import { indicativeLinePrice, type IndicativeScenarioLine } from "./index";

/**
 * Bytes in one capacity unit. Decimal units are powers of ten (1 TB is
 * 1,000 GB); binary units are powers of two (1 TiB is 1,024 GiB).
 */
const unitBytes: Readonly<Record<string, bigint>> = {
  GB: 10n ** 9n,
  TB: 10n ** 12n,
  PB: 10n ** 15n,
  TiB: 2n ** 40n,
  PiB: 2n ** 50n,
};

/**
 * `quantity` of `from` expressed in `to`, exactly, or null when either unit
 * is unknown or the result needs more than 18 decimal places. Every entry of
 * up to six decimals in TB, PB, TiB or PiB converts exactly to TB: 1 PiB is
 * 1,125.899906842624 TB.
 */
export function convertCapacity(
  quantity: string,
  from: string,
  to: string,
): string | null {
  if (from === to) return quantity;
  const fromBytes = unitBytes[from];
  const toBytes = unitBytes[to];
  if (!fromBytes || !toBytes) return null;
  const scaled = parseDecimal(quantity) * fromBytes;
  if (scaled % toBytes !== 0n) return null;
  return formatDecimal(scaled / toBytes);
}

/** Money for one aggregate of a partner model, all in minor units. */
export interface PartnerFigures {
  /** What the end customer pays: to Fil One, or to the partner on resale. */
  customerSpend: Money;
  partnerEarnings: Money;
  /** What Fil One keeps after the partner's share. */
  filOneNet: Money;
}

/** A run of months over which every rate and line holds constant. */
export interface PartnerPeriod {
  fromMonth: number;
  toMonth: number;
  /** Referral only: the commission in force over the period. */
  commissionBps?: number;
  /**
   * Any one month of the period, each line rounded once for that month. The
   * months of a period can differ from it by a cent where they are summed
   * into years and the term.
   */
  monthly: PartnerFigures;
  /** One capacity unit for one month of the period. */
  perUnit: PartnerFigures;
}

export interface ScenarioPartnerEconomics {
  model: PricingPartnerEconomics["model"];
  currency: Currency;
  /** The longest line term: the months the economics run over. */
  months: number;
  /** Resale only: both prices per unit and the margin between them. */
  resale?: {
    customerPrice: Money;
    buyPrice: Money;
    /** The partner's margin on its customer price; null at a zero price. */
    marginBps: number | null;
  };
  firstMonth: PartnerFigures;
  /** Months 1 to 12, or the whole term when it is shorter. */
  firstYear: PartnerFigures;
  term: PartnerFigures;
  /** Each contract year: months 1-12, 13-24 and so on. */
  years: PartnerFigures[];
  periods: PartnerPeriod[];
}

/**
 * The resale price the seller did not give: Fil One's price to the partner
 * from a margin on the partner's customer price, or that margin from the
 * two prices. Margin is (customer price - buy price) / customer price, so
 * $6.50 at 32% is a buy price of $4.42.
 */
export function resaleTerms(input: {
  customerPriceMinor: string;
  buyPriceMinor?: string | undefined;
  marginBps?: number | undefined;
}): {
  customerPriceMinor: bigint;
  buyPriceMinor: bigint;
  marginBps: number | null;
} {
  const customer = BigInt(input.customerPriceMinor);
  if (input.buyPriceMinor !== undefined) {
    const buy = BigInt(input.buyPriceMinor);
    return {
      customerPriceMinor: customer,
      buyPriceMinor: buy,
      marginBps:
        customer > 0n
          ? Number(divideRound((customer - buy) * 10_000n, customer))
          : null,
    };
  }
  const margin = input.marginBps ?? 0;
  if (!Number.isInteger(margin) || margin < 0 || margin > 10_000)
    throw new Error("Margin must be between 0 and 10000 basis points");
  const buy = divideRound(customer * BigInt(10_000 - margin), 10_000n);
  // The margin shown is the one the rounded buy price gives, so the two
  // printed figures always agree.
  return resaleTerms({
    customerPriceMinor: input.customerPriceMinor,
    buyPriceMinor: buy.toString(),
  });
}

/**
 * What a partner earns and what Fil One keeps on an indicative scenario,
 * month by month over the longest line term. Lines are priced as
 * `indicativeScenarioPrice` prices them, list less the entered discount;
 * nothing here reads a floor, a transfer price or a policy cap.
 *
 * Each line's running figures are worked out exactly and rounded half up,
 * and a span of months is the difference of two running totals. So months
 * add up to years and years to the term, a referral's or other model's
 * customer spend over the term is the scenario total, and Fil One's net is
 * always customer spend less partner earnings.
 */
export function scenarioPartnerEconomics(
  lines: readonly IndicativeScenarioLine[],
  economics: PricingPartnerEconomics,
): ScenarioPartnerEconomics {
  const currency = lines[0]?.unitPrice.currency;
  if (!currency) throw new Error("A scenario requires at least one line");
  if (lines.some((line) => line.unitPrice.currency !== currency))
    throw new Error("Scenario lines must share one currency");
  const priced = lines.map((line) => ({
    unitMinor: BigInt(indicativeLinePrice(line).unitPrice.minor),
    quantity: parseDecimal(line.quantity),
    termMonths: line.termMonths,
  }));
  const months = Math.max(...priced.map(({ termMonths }) => termMonths));
  const money = (minor: bigint) =>
    ({ currency, minor: minor.toString() }) as Money;
  const scale = QUANTITY_SCALE * 10_000n;

  const commissionAt = (month: number) => {
    if (economics.model !== "referral") return 0;
    let rate = economics.commissionBps;
    for (const step of economics.steps)
      if (step.fromMonth <= month) rate = step.commissionBps;
    return rate;
  };
  const resale =
    economics.model === "resale" ? resaleTerms(economics) : undefined;

  /**
   * Months 1 to `through`, each line's figures rounded once. Fixed monthly
   * amounts are whole minor units, so they need no rounding.
   */
  function cumulative(through: number) {
    let spend = 0n;
    let partner = 0n;
    for (const line of priced) {
      const live = Math.max(0, Math.min(through, line.termMonths));
      if (live === 0) continue;
      if (resale) {
        const lineSpend = divideRound(
          resale.customerPriceMinor * line.quantity * BigInt(live),
          QUANTITY_SCALE,
        );
        const lineFilOne = divideRound(
          resale.buyPriceMinor * line.quantity * BigInt(live),
          QUANTITY_SCALE,
        );
        spend += lineSpend;
        partner += lineSpend - lineFilOne;
        continue;
      }
      const exact = line.unitMinor * line.quantity;
      spend += divideRound(exact * BigInt(live), QUANTITY_SCALE);
      if (economics.model === "referral") {
        let bps = 0n;
        for (let month = 1; month <= live; month++)
          bps += BigInt(commissionAt(month));
        partner += divideRound(exact * bps, scale);
      } else if (economics.model === "other")
        partner += divideRound(
          (exact * BigInt(economics.partnerShareBps) +
            BigInt(economics.partnerPerUnitMinor) * line.quantity * 10_000n) *
            BigInt(live),
          scale,
        );
    }
    if (economics.model === "other")
      partner +=
        BigInt(economics.partnerMonthlyMinor) *
        BigInt(Math.max(0, Math.min(through, months)));
    return { spend, partner };
  }

  /** One month on its own, each line's figure rounded once. */
  function monthAt(month: number): PartnerFigures {
    let spend = 0n;
    let partner = 0n;
    for (const line of priced) {
      if (line.termMonths < month) continue;
      if (resale) {
        const lineSpend = divideRound(
          resale.customerPriceMinor * line.quantity,
          QUANTITY_SCALE,
        );
        spend += lineSpend;
        partner +=
          lineSpend -
          divideRound(resale.buyPriceMinor * line.quantity, QUANTITY_SCALE);
        continue;
      }
      const exact = line.unitMinor * line.quantity;
      spend += divideRound(exact, QUANTITY_SCALE);
      if (economics.model === "referral")
        partner += divideRound(exact * BigInt(commissionAt(month)), scale);
      else if (economics.model === "other")
        partner += divideRound(
          exact * BigInt(economics.partnerShareBps) +
            BigInt(economics.partnerPerUnitMinor) * line.quantity * 10_000n,
          scale,
        );
    }
    if (economics.model === "other" && month <= months)
      partner += BigInt(economics.partnerMonthlyMinor);
    return {
      customerSpend: money(spend),
      partnerEarnings: money(partner),
      filOneNet: money(spend - partner),
    };
  }

  /**
   * Months `from` to `to`, inclusive, as the difference of two cumulative
   * figures: months add up to years and years to the term to the cent.
   */
  function window(from: number, to: number): PartnerFigures {
    const end = cumulative(to);
    const start = cumulative(from - 1);
    const spend = end.spend - start.spend;
    const partner = end.partner - start.partner;
    return {
      customerSpend: money(spend),
      partnerEarnings: money(partner),
      filOneNet: money(spend - partner),
    };
  }

  /** One capacity unit for month `month`, from the lines live then. */
  function perUnit(month: number): PartnerFigures {
    const live = priced.filter(({ termMonths }) => termMonths >= month);
    const units = live.reduce((sum, line) => sum + line.quantity, 0n);
    if (units === 0n)
      return {
        customerSpend: money(0n),
        partnerEarnings: money(0n),
        filOneNet: money(0n),
      };
    if (resale)
      return {
        customerSpend: money(resale.customerPriceMinor),
        partnerEarnings: money(
          resale.customerPriceMinor - resale.buyPriceMinor,
        ),
        filOneNet: money(resale.buyPriceMinor),
      };
    const revenue = live.reduce(
      (sum, line) => sum + line.unitMinor * line.quantity,
      0n,
    );
    const spend = divideRound(revenue, units);
    const partner =
      economics.model === "referral"
        ? divideRound(revenue * BigInt(commissionAt(month)), units * 10_000n)
        : economics.model === "other"
          ? divideRound(
              revenue * BigInt(economics.partnerShareBps) +
                BigInt(economics.partnerPerUnitMinor) * units * 10_000n +
                BigInt(economics.partnerMonthlyMinor) * scale,
              units * 10_000n,
            )
          : 0n;
    return {
      customerSpend: money(spend),
      partnerEarnings: money(partner),
      filOneNet: money(spend - partner),
    };
  }

  const starts = new Set([1]);
  if (economics.model === "referral")
    for (const step of economics.steps)
      if (step.fromMonth <= months) starts.add(step.fromMonth);
  for (const { termMonths } of priced)
    if (termMonths < months) starts.add(termMonths + 1);
  const ordered = [...starts].toSorted((left, right) => left - right);
  const periods = ordered.map((fromMonth, index): PartnerPeriod => {
    const next = ordered[index + 1];
    return {
      fromMonth,
      toMonth: next === undefined ? months : next - 1,
      ...(economics.model === "referral"
        ? { commissionBps: commissionAt(fromMonth) }
        : {}),
      monthly: monthAt(fromMonth),
      perUnit: perUnit(fromMonth),
    };
  });
  const years = Array.from({ length: Math.ceil(months / 12) }, (_, index) =>
    window(index * 12 + 1, Math.min((index + 1) * 12, months)),
  );
  return {
    model: economics.model,
    currency,
    months,
    ...(resale
      ? {
          resale: {
            customerPrice: money(resale.customerPriceMinor),
            buyPrice: money(resale.buyPriceMinor),
            marginBps: resale.marginBps,
          },
        }
      : {}),
    firstMonth: window(1, 1),
    firstYear: years[0] ?? window(1, months),
    term: window(1, months),
    years,
    periods,
  };
}
