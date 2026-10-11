import { describe, expect, it, vi } from "vitest";

import type { PartnerNextStepDue } from "@clockwork/contracts";

import { remindPartnerNextSteps } from "./partner-reminders";

const row = (patch: Partial<PartnerNextStepDue>): PartnerNextStepDue => ({
  partnerId: "p0000000-0000-4000-8000-000000000001",
  partnerName: "Northwind Channel Co.",
  ownerId: "u0000000-0000-4000-8000-000000000001",
  ownerName: "Sam Seller",
  nextStep: "Send the referral letter",
  nextStepDue: "2026-10-10",
  overdue: false,
  ...patch,
});

describe("the daily partner reminder", () => {
  it("reads steps due through today and reminds each owned partner once", async () => {
    const nextStepsDue = vi.fn(() =>
      Promise.resolve([
        row({}),
        row({ partnerId: "p2", nextStepDue: "2026-10-01", overdue: true }),
        row({ partnerId: "p3", ownerId: null }),
      ]),
    );
    const remindPartnerNextStep = vi
      .fn()
      .mockResolvedValueOnce(true)
      // Already reminded for that due date on an earlier run.
      .mockResolvedValueOnce(false);
    const result = await remindPartnerNextSteps("2026-10-10", {
      partners: { nextStepsDue },
      store: { remindPartnerNextStep },
      log: () => {},
    });
    expect(nextStepsDue).toHaveBeenCalledWith({
      through: "2026-10-10",
      today: "2026-10-10",
    });
    expect(remindPartnerNextStep).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ today: "2026-10-10", due: 3, reminded: 1 });
  });
});
