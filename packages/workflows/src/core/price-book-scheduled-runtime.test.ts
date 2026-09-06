import { describe, expect, it, vi } from "vitest";
import {
  configurePriceBookScheduleRepository,
  runPriceBookScheduleOccurrence,
  runPriceBookScheduleSweep,
} from "./price-book-scheduled-runtime";
describe("price-book schedule sweep", () => {
  it("uses actual execution time when a scheduled occurrence is retried after expiry", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-11T00:00:00Z"));
      const runDue = vi
        .fn()
        .mockResolvedValue({ results: [{ status: "expired" }] });
      configurePriceBookScheduleRepository({ runDue });
      await expect(
        runPriceBookScheduleOccurrence("2026-09-08T00:00:00Z"),
      ).resolves.toMatchObject({
        scheduledAt: "2026-09-08T00:00:00Z",
        result: { results: [{ status: "expired" }] },
      });
      expect(runDue).toHaveBeenCalledExactlyOnceWith(
        "2026-09-11T00:00:00.000Z",
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it("dispatches actual UTC occurrences to durable approved state", async () => {
    const runDue = vi
      .fn()
      .mockResolvedValue({ results: [{ status: "executed" }] });
    configurePriceBookScheduleRepository({ runDue });
    await expect(
      runPriceBookScheduleSweep("2026-09-08T00:00:00Z"),
    ).resolves.toMatchObject({ results: [{ status: "executed" }] });
    expect(runDue).toHaveBeenCalledExactlyOnceWith("2026-09-08T00:00:00.000Z");
    await expect(runPriceBookScheduleSweep("invalid")).rejects.toThrow(
      "TIME_INVALID",
    );
    expect(runDue).toHaveBeenCalledTimes(1);
  });
});
