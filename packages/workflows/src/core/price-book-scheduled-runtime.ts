export interface PriceBookScheduleRunner {
  runDue(now: string): Promise<unknown>;
}
let repository: PriceBookScheduleRunner | undefined;
export function configurePriceBookScheduleRepository(
  value: PriceBookScheduleRunner,
) {
  repository = value;
}
export async function runPriceBookScheduleSweep(now: string) {
  if (!repository)
    throw new Error("PRICE_BOOK_SCHEDULE_REPOSITORY_NOT_CONFIGURED");
  const at = new Date(now);
  if (!Number.isFinite(at.getTime()))
    throw new Error("PRICE_BOOK_SCHEDULE_TIME_INVALID");
  return repository.runDue(at.toISOString());
}

/** Retry metadata is not the execution clock: a late job must honor expiry. */
export async function runPriceBookScheduleOccurrence(scheduledAt: string) {
  const result = await runPriceBookScheduleSweep(new Date().toISOString());
  return { scheduledAt, result };
}
