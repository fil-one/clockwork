import { afterEach, describe, expect, it, vi } from "vitest";

import type * as ScheduledRuntime from "./scheduled-runtime";
import { coreScheduleDefinitions } from "./scheduled-runtime";

type CoreScheduleDefinitionId = (typeof coreScheduleDefinitions)[number]["id"];

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("./scheduled-runtime");
});

/**
 * Defining a task registers it, so each reload starts from a fresh module
 * graph: the registry the reloaded schedules write to is the one read back
 * here, and the duplicate-id guard never sees the same task twice.
 */
async function load() {
  vi.resetModules();
  const registry = await import("../tasks/registry");
  const tasks = (await import("./scheduled-tasks")) as unknown as Record<
    string,
    { id: string }
  >;
  return { tasks, captured: registry.listScheduledTasks() };
}

describe("core schedule task bindings", () => {
  it("pairs every export with the definition of the same name", async () => {
    const { tasks, captured } = await load();
    const byName = new Map(
      coreScheduleDefinitions.map((entry) => [entry.id, entry]),
    );
    // Typing the values as the definition-id union makes a typo here a compile
    // error rather than a lookup that silently misses and compares undefined
    // to undefined.
    const expected: Record<string, CoreScheduleDefinitionId> = {
      syncOverageSchedule: "core.schedule.sync-overage.v1",
      dunningSchedule: "core.schedule.dunning.v1",
      partnerCreditSchedule: "core.schedule.partner-credit.v1",
      commissionSettlementSchedule: "core.schedule.commission-settlement.v1",
      usageReconciliationSchedule: "core.schedule.usage-reconciliation.v1",
      threeWayReconciliationSchedule:
        "core.schedule.three-way-reconciliation.v1",
      weeklyReportExportSchedule: "core.schedule.report-export-weekly.v1",
      monthlyReportExportSchedule: "core.schedule.report-export-monthly.v1",
      procurementCertificateExpirySchedule:
        "core.schedule.procurement-certificate-expiry.v1",
    };
    for (const [name, id] of Object.entries(expected)) {
      expect(tasks[name]?.id, name).toBe(id);
      const definition = captured.find((entry) => entry.id === id);
      expect(definition?.cron, name).toBe(byName.get(id)?.cron);
    }
    expect(captured).toHaveLength(coreScheduleDefinitions.length);
  });

  /**
   * The regression itself: the exports used to index the definition array, so a
   * definition inserted anywhere but the end handed every later export the
   * wrong id and cron. Reversing the list is the cheapest way to reproduce an
   * insertion without editing the shipped order.
   */
  it("survives a reordered definition list", async () => {
    vi.doMock("./scheduled-runtime", async () => {
      const actual = await vi.importActual<typeof ScheduledRuntime>(
        "./scheduled-runtime",
      );
      return {
        ...actual,
        coreScheduleDefinitions: [...actual.coreScheduleDefinitions].reverse(),
      };
    });
    const { tasks, captured } = await load();
    expect(tasks.syncOverageSchedule?.id).toBe("core.schedule.sync-overage.v1");
    expect(tasks.procurementCertificateExpirySchedule?.id).toBe(
      "core.schedule.procurement-certificate-expiry.v1",
    );
    expect(
      captured.find((entry) => entry.id === "core.schedule.dunning.v1")?.cron,
    ).toBe("0 7 * * *");
  });

  it("randomizes the retry the schedules carry", async () => {
    const { captured } = await load();
    expect(captured).not.toHaveLength(0);
    for (const definition of captured)
      expect(definition.retry.randomize, definition.id).toBe(true);
  });
});
