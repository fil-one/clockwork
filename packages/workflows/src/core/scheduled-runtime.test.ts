import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configureCoreScheduleOccurrenceStore,
  coreScheduleDefinitions,
  resetCoreScheduleOccurrenceStoreForTests,
  submitCoreScheduleOccurrence,
} from "./scheduled-runtime";

afterEach(() => resetCoreScheduleOccurrenceStoreForTests());

describe("durable core schedule submission", () => {
  it("defines the required UTC commercial operations with stable identities", () => {
    expect(coreScheduleDefinitions).toEqual([
      expect.objectContaining({ dispatches: "core.billing.sync-overage.v1" }),
      expect.objectContaining({ dispatches: "core.collections.dunning.v1" }),
      expect.objectContaining({
        dispatches: "core.collections.partner-credit.v1",
      }),
      expect.objectContaining({ dispatches: "core.commissions.settle.v1" }),
      expect.objectContaining({
        dispatches: "core.reconciliation.usage.v1",
      }),
      expect.objectContaining({
        dispatches: "core.reconciliation.three-way.v1",
      }),
      expect.objectContaining({ dispatches: "core.reporting.export.v1" }),
      expect.objectContaining({ dispatches: "core.reporting.export.v1" }),
      expect.objectContaining({
        dispatches: "core.procurement.certificate-expiry.v1",
      }),
    ]);
    expect(new Set(coreScheduleDefinitions.map(({ id }) => id)).size).toBe(
      coreScheduleDefinitions.length,
    );
  });

  it("hands duplicate deliveries and crash recovery to the durable store", async () => {
    const enqueue = vi
      .fn()
      .mockResolvedValueOnce({
        occurrenceId: "10000000-0000-4000-8000-000000000001",
        eventId: "20000000-0000-4000-8000-000000000001",
        queued: true,
      })
      .mockResolvedValueOnce({
        occurrenceId: "10000000-0000-4000-8000-000000000001",
        eventId: "20000000-0000-4000-8000-000000000001",
        queued: false,
      });
    configureCoreScheduleOccurrenceStore({ enqueue });
    const occurrence = {
      scheduleId: "core.schedule.dunning.v1" as const,
      scheduledAt: "2026-07-31T07:00:00.000Z",
      triggerRunId: "trigger-run-after-recovery",
    };
    await expect(
      submitCoreScheduleOccurrence(occurrence),
    ).resolves.toMatchObject({ queued: true });
    await expect(
      submitCoreScheduleOccurrence(occurrence),
    ).resolves.toMatchObject({ queued: false });
    expect(enqueue).toHaveBeenNthCalledWith(1, occurrence);
    expect(enqueue).toHaveBeenNthCalledWith(2, occurrence);
  });

  it("fails closed before production runtime composition", async () => {
    await expect(
      submitCoreScheduleOccurrence({
        scheduleId: "core.schedule.usage-reconciliation.v1",
        scheduledAt: "2026-07-31T02:30:00.000Z",
        triggerRunId: "unconfigured-run",
      }),
    ).rejects.toThrow("CORE_SCHEDULE_STORE_NOT_CONFIGURED");
  });
});
