import { describe, expect, it, vi } from "vitest";

import type { PartnerNextStepDue } from "@clockwork/contracts";

import { remindPartnerNextSteps } from "./partner-reminders";

const row = (
  partnerId: string,
  nextStepDue = "2026-10-10",
): PartnerNextStepDue => ({
  partnerId,
  partnerName: `Partner ${partnerId}`,
  ownerId: "u0000000-0000-4000-8000-000000000001",
  ownerName: "Sam Seller",
  nextStep: "",
  nextStepDue,
  overdue: nextStepDue < "2026-10-10",
});

describe("the daily partner reminder", () => {
  it("reads every page from the last partner of the one before", async () => {
    const pages = [[row("p1", "2026-10-01"), row("p2")], [row("p3")]];
    const partnerNextStepsToRemind = vi.fn(() =>
      Promise.resolve(pages.shift() ?? []),
    );
    const remindPartnerNextStep = vi.fn(() => Promise.resolve(true));
    const result = await remindPartnerNextSteps("2026-10-10", {
      store: { partnerNextStepsToRemind, remindPartnerNextStep },
      pageSize: 2,
      log: () => {},
    });
    expect(partnerNextStepsToRemind.mock.calls).toEqual([
      [{ today: "2026-10-10", limit: 2 }],
      [
        {
          today: "2026-10-10",
          limit: 2,
          after: { nextStepDue: "2026-10-10", partnerId: "p2" },
        },
      ],
    ]);
    expect(result).toEqual({
      today: "2026-10-10",
      due: 3,
      reminded: 3,
      failed: 0,
    });
  });

  it("logs a partner that fails and finishes the run", async () => {
    const log = vi.fn();
    const remindPartnerNextStep = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(true)
      // Another run reminded it first.
      .mockResolvedValueOnce(false);
    const result = await remindPartnerNextSteps("2026-10-10", {
      store: {
        partnerNextStepsToRemind: vi
          .fn()
          .mockResolvedValueOnce([row("p1"), row("p2"), row("p3")]),
        remindPartnerNextStep,
      },
      log,
    });
    expect(result).toMatchObject({ due: 3, reminded: 1, failed: 1 });
    expect(log).toHaveBeenCalledWith({
      event: "PARTNER_NEXT_STEP_REMINDER_FAILED",
      partnerId: "p1",
      error: "connection reset",
    });
    expect(log).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: "PARTNER_NEXT_STEP_REMINDERS",
        failed: 1,
      }),
    );
  });
});
