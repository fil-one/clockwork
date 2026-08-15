import { afterEach, describe, expect, it, vi } from "vitest";

import type * as ScheduledRuntime from "./scheduled-runtime";
import { coreScheduleDefinitions } from "./scheduled-runtime";

interface CapturedSchedule {
  id: string;
  cron: { pattern: string; timezone: string };
  retry: { randomize?: boolean };
}

type CoreScheduleDefinitionId = (typeof coreScheduleDefinitions)[number]["id"];

const captured: CapturedSchedule[] = [];

vi.mock("@trigger.dev/sdk", () => ({
  schedules: {
    task: (definition: CapturedSchedule) => {
      captured.push(definition);
      return { id: definition.id };
    },
  },
}));

afterEach(() => {
  captured.length = 0;
  vi.resetModules();
  vi.doUnmock("./scheduled-runtime");
});

async function load() {
  vi.resetModules();
  captured.length = 0;
  return import("./scheduled-tasks");
}

describe("core schedule task bindings", () => {
  it("pairs every export with the definition of the same name", async () => {
    const tasks = (await load()) as Record<string, { id: string }>;
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
      expect(definition?.cron.pattern, name).toBe(byName.get(id)?.cron);
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
    const tasks = (await load()) as Record<string, { id: string }>;
    expect(tasks.syncOverageSchedule?.id).toBe("core.schedule.sync-overage.v1");
    expect(tasks.procurementCertificateExpirySchedule?.id).toBe(
      "core.schedule.procurement-certificate-expiry.v1",
    );
    expect(
      captured.find((entry) => entry.id === "core.schedule.dunning.v1")?.cron
        .pattern,
    ).toBe("0 7 * * *");
  });

  it("randomizes the retry the schedules hand Trigger", async () => {
    await load();
    expect(captured).not.toHaveLength(0);
    for (const definition of captured)
      expect(definition.retry.randomize, definition.id).toBe(true);
  });
});
