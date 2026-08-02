import type {
  CoreScheduleId,
  CoreScheduleOccurrence,
  EnqueuedCoreScheduleOccurrence,
} from "@clockwork/db";

export interface CoreScheduleOccurrenceStore {
  enqueue(
    input: CoreScheduleOccurrence,
  ): Promise<EnqueuedCoreScheduleOccurrence>;
}

export const coreScheduleDefinitions = [
  {
    id: "core.schedule.sync-overage.v1",
    cron: "15 * * * *",
    dispatches: "core.billing.sync-overage.v1",
  },
  {
    id: "core.schedule.dunning.v1",
    cron: "0 7 * * *",
    dispatches: "core.collections.dunning.v1",
  },
  {
    id: "core.schedule.partner-credit.v1",
    cron: "0 6 * * *",
    dispatches: "core.collections.partner-credit.v1",
  },
  {
    id: "core.schedule.commission-settlement.v1",
    cron: "0 6 1 */3 *",
    dispatches: "core.commissions.settle.v1",
  },
  {
    id: "core.schedule.usage-reconciliation.v1",
    cron: "30 2 * * *",
    dispatches: "core.reconciliation.usage.v1",
  },
  {
    id: "core.schedule.three-way-reconciliation.v1",
    cron: "0 5 1 * *",
    dispatches: "core.reconciliation.three-way.v1",
  },
  {
    id: "core.schedule.report-export-weekly.v1",
    cron: "0 8 * * 1",
    dispatches: "core.reporting.export.v1",
  },
  {
    id: "core.schedule.report-export-monthly.v1",
    cron: "0 8 1 * *",
    dispatches: "core.reporting.export.v1",
  },
  // Appended rather than grouped with the other daily sweeps: the exported
  // schedule tasks below bind to these positions.
  {
    id: "core.schedule.procurement-certificate-expiry.v1",
    cron: "0 4 * * *",
    dispatches: "core.procurement.certificate-expiry.v1",
  },
] as const satisfies readonly {
  id: CoreScheduleId;
  cron: string;
  dispatches: string;
}[];

let configuredStore: CoreScheduleOccurrenceStore | undefined;

export function configureCoreScheduleOccurrenceStore(
  store: CoreScheduleOccurrenceStore,
): void {
  if (configuredStore && configuredStore !== store)
    throw new Error("CORE_SCHEDULE_STORE_ALREADY_CONFIGURED");
  configuredStore = store;
}

export function resetCoreScheduleOccurrenceStoreForTests(): void {
  if (process.env.NODE_ENV === "production")
    throw new Error("CORE_SCHEDULE_STORE_RESET_FORBIDDEN");
  configuredStore = undefined;
}

export function submitCoreScheduleOccurrence(
  input: CoreScheduleOccurrence,
): Promise<EnqueuedCoreScheduleOccurrence> {
  if (!configuredStore)
    return Promise.reject(new Error("CORE_SCHEDULE_STORE_NOT_CONFIGURED"));
  return configuredStore.enqueue(input);
}
