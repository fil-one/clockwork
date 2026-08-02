import { describe, expect, it } from "vitest";

import {
  epochDay,
  scheduledCertificateVersion,
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

  it("holds the stage identity across a payment that touches the invoice", () => {
    const dueAt = new Date("2026-06-30T16:00:00.000Z");
    expect(scheduledDunningVersion(epochDay(dueAt), 1)).toBe(
      scheduledDunningVersion(epochDay(dueAt), 1),
    );
    expect(epochDay(new Date("2026-06-30T00:00:00.000Z"))).toBe(
      epochDay(new Date("2026-06-30T23:59:59.000Z")),
    );
    expect(scheduledDunningVersion(epochDay(dueAt), 2)).toBe(
      scheduledDunningVersion(epochDay(dueAt), 1) + 1,
    );
  });
});

describe("scheduled certificate sweep identity", () => {
  const expiresOn = epochDay(new Date("2026-08-10T00:00:00.000Z"));

  it("holds one identity while a certificate stays inside the notice window", () => {
    expect(scheduledCertificateVersion(expiresOn, 1)).toBe(
      scheduledCertificateVersion(expiresOn, 1),
    );
  });

  it("advances exactly once when the certificate lapses", () => {
    expect(scheduledCertificateVersion(expiresOn, 2)).toBe(
      scheduledCertificateVersion(expiresOn, 1) + 1,
    );
  });

  it("separates certificates that expire on different days", () => {
    const later = epochDay(new Date("2026-08-11T00:00:00.000Z"));
    expect(scheduledCertificateVersion(later, 1)).not.toBe(
      scheduledCertificateVersion(expiresOn, 1),
    );
    expect(scheduledCertificateVersion(later, 1)).toBeGreaterThan(
      scheduledCertificateVersion(expiresOn, 2),
    );
  });
});
