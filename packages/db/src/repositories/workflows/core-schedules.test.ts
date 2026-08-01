import { describe, expect, it } from "vitest";

import {
  scheduledDunningStage,
  scheduledDunningVersion,
} from "./core-schedules";

describe("scheduled dunning identity", () => {
  it("keeps duplicate daily deliveries stable within a threshold", () => {
    expect(scheduledDunningStage(7)).toEqual({
      ordinal: 1,
      decisionDaysPastDue: 7,
    });
    expect(scheduledDunningStage(29)).toEqual({
      ordinal: 1,
      decisionDaysPastDue: 7,
    });
    expect(scheduledDunningVersion(4, 1)).toBe(13);
  });

  it("advances identity exactly when the next threshold is reached", () => {
    expect(scheduledDunningStage(30)).toEqual({
      ordinal: 2,
      decisionDaysPastDue: 30,
    });
    expect(scheduledDunningStage(60)).toEqual({
      ordinal: 2,
      decisionDaysPastDue: 30,
    });
    expect(scheduledDunningVersion(4, 2)).toBe(14);
  });
});
