import type { DatabasePaygBillingRepository } from "./database-payg";

let repository:
  | Pick<DatabasePaygBillingRepository, "closeMonth" | "billingMonths">
  | undefined;
export function configurePaygScheduleRepository(
  value: Pick<DatabasePaygBillingRepository, "closeMonth" | "billingMonths">,
): void {
  repository = value;
}

/** Revisit all open correction windows; immutable revisions make retries safe. */
export async function runPaygBillingSweep(now: string) {
  if (!repository) throw new Error("PAYG_SCHEDULE_REPOSITORY_NOT_CONFIGURED");
  const at = new Date(now);
  if (!Number.isFinite(at.getTime()) || at.toISOString() !== now)
    throw new Error("PAYG_SCHEDULE_TIME_INVALID");
  const months = await repository.billingMonths(now);
  const results = [];
  for (const month of months)
    results.push({
      month,
      results: await repository.closeMonth({ month, now }),
    });
  return { asOf: now, periods: results };
}
