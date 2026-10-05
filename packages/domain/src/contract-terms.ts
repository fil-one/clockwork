import type { ContractTermSchedule } from "@clockwork/contracts";

/**
 * Term arithmetic for the staff contract register.
 *
 * A term of N months that starts on the effective date E ends on the day
 * before E + N months, with month arithmetic clamped to the last day of the
 * shorter month exactly as PostgreSQL's `date + interval 'N months'` does
 * (2024-01-31 + 1 month = 2024-02-29). Each renewal boundary is measured from
 * the effective date, never from the previous boundary, so a 31 January
 * contract renews on 31 March after two monthly terms rather than drifting to
 * the 28th. `supabase/migrations/001443_commerce_contracts.sql` holds the same
 * rule for filtering and sorting; the repository tests hold the two together.
 *
 * The notice deadline is conservative: notice of non-renewal "at least N days
 * before the end of the term" must arrive by the term's last day minus N days.
 */
export interface ContractTerm {
  effectiveDate: string | null;
  initialTermMonths: number | null;
  autoRenew: boolean;
  renewalTermMonths: number | null;
  noticePeriodDays: number | null;
}

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(date: string) {
  const match = datePattern.exec(date);
  if (!match) throw new Error("CONTRACT_DATE_INVALID");
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day)
    throw new Error("CONTRACT_DATE_INVALID");
  return { year, month, day };
}

function format(value: Date) {
  return value.toISOString().slice(0, 10);
}

/** `date + N months`, clamped to the end of the target month. */
export function addContractMonths(date: string, months: number): string {
  const { year, month, day } = parse(date);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index - targetYear * 12;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  return format(
    new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay))),
  );
}

export function addContractDays(date: string, days: number): string {
  const { year, month, day } = parse(date);
  return format(new Date(Date.UTC(year, month - 1, day + days)));
}

/**
 * The first day after the current term, as of `asOf`: the expiry boundary of
 * a fixed term, or the next renewal boundary of an auto-renewing contract.
 * `null` when the contract has no fixed term.
 */
export function contractTermBoundary(
  term: ContractTerm,
  asOf: string,
): string | null {
  if (!term.effectiveDate || !term.initialTermMonths) return null;
  const first = addContractMonths(term.effectiveDate, term.initialTermMonths);
  if (!term.autoRenew || !term.renewalTermMonths || first > asOf) return first;
  const elapsed = (() => {
    const a = parse(first);
    const b = parse(asOf);
    return (b.year - a.year) * 12 + (b.month - a.month);
  })();
  // Start just below the boundary that `elapsed` months implies, then step.
  let renewals = Math.max(0, Math.floor(elapsed / term.renewalTermMonths) - 1);
  for (;;) {
    const boundary = addContractMonths(
      term.effectiveDate,
      term.initialTermMonths + renewals * term.renewalTermMonths,
    );
    if (boundary > asOf) return boundary;
    renewals += 1;
  }
}

export function contractTermSchedule(
  term: ContractTerm,
  asOf: string,
): ContractTermSchedule {
  const boundary = contractTermBoundary(term, asOf);
  if (!boundary)
    return { termEndDate: null, renewalDate: null, noticeDeadline: null };
  const termEndDate = addContractDays(boundary, -1);
  const renews = term.autoRenew && Boolean(term.renewalTermMonths);
  return {
    termEndDate,
    renewalDate: renews ? boundary : null,
    noticeDeadline:
      renews && term.noticePeriodDays !== null
        ? addContractDays(termEndDate, -term.noticePeriodDays)
        : null,
  };
}

/** Today's calendar date in UTC, the zone every staff surface labels. */
export function contractToday(now: Date = new Date()): string {
  return format(now);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function contractDaysBetween(from: string, to: string): number {
  const a = parse(from);
  const b = parse(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) -
      Date.UTC(a.year, a.month - 1, a.day)) /
      86_400_000,
  );
}
