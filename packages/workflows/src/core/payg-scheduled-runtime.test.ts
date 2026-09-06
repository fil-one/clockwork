import { describe, expect, it, vi } from "vitest";
import {
  configurePaygScheduleRepository,
  runPaygBillingSweep,
} from "./payg-scheduled-runtime";

describe("scheduled PAYG billing close", () => {
  it("visits retained enrollment periods, including old backlog, and returns blocked accounts for redrive", async () => {
    const closeMonth = vi.fn((input: { month: string }) =>
      Promise.resolve([
        {
          enrollmentId: "enrollment",
          status: "blocked" as const,
          reason: `missing-source:${input.month}`,
        },
      ]),
    );
    configurePaygScheduleRepository({
      billingMonths: () => Promise.resolve(["2020-01", "2026-09"]),
      closeMonth,
    });
    const result = await runPaygBillingSweep("2026-09-06T03:00:00.000Z");
    expect(closeMonth.mock.calls).toEqual([
      [{ month: "2020-01", now: "2026-09-06T03:00:00.000Z" }],
      [{ month: "2026-09", now: "2026-09-06T03:00:00.000Z" }],
    ]);
    expect(result.periods).toHaveLength(2);
    expect(result.periods[0]?.results[0]?.status).toBe("blocked");
  });
  it("rejects noncanonical scheduler timestamps", async () => {
    await expect(runPaygBillingSweep("yesterday")).rejects.toThrow(
      "PAYG_SCHEDULE_TIME_INVALID",
    );
  });
});
