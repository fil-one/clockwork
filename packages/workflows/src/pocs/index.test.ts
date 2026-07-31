import { describe, expect, it } from "vitest";

import {
  addBusinessDays,
  planPocConversion,
  planPocSchedule,
  waitForPocQualification,
} from "./index";

const poc = {
  pocId: "poc-1",
  accountId: "account-1",
  organizationId: "org-poc",
  version: 1,
  status: "active" as const,
  qualificationApproved: true,
  kickoffAt: "2026-07-01T16:00:00.000Z",
  midpointAt: "2026-07-15T16:00:00.000Z",
  finalReportAt: "2026-07-30T16:00:00.000Z",
  expiresAt: "2026-08-01T16:00:00.000Z",
  supportOwnerId: "support-1",
  recipients: ["buyer@example.test"],
};

describe("POC workflows", () => {
  it("uses a durable approval wait", () => {
    const workflow = waitForPocQualification({
      pocId: "poc-1",
      version: 1,
      expiresAt: "2026-08-01T00:00:00.000Z",
    });
    expect(workflow.effect.kind).toBe("open_poc_qualification");
    expect(workflow.wait.resumeEvents).toEqual([
      "poc.qualification-approved",
      "poc.qualification-rejected",
    ]);
  });

  it("plans milestones, proposal, alerts, and expiry deterministically", () => {
    const effects = planPocSchedule({
      poc,
      now: "2026-08-02T16:00:00.000Z",
      proposalLeadDays: 7,
    });
    expect(effects.map((effect) => effect.kind)).toEqual([
      "notify_poc_milestone",
      "notify_poc_milestone",
      "notify_poc_milestone",
      "generate_poc_proposal",
      "expire_poc",
    ]);
    expect(new Set(effects.map((effect) => effect.idempotencyKey)).size).toBe(
      effects.length,
    );
  });

  it("converts by upgrading and reparenting the same organization", () => {
    const effects = planPocConversion({
      poc,
      paidOrderId: "order-1",
      paidOrganizationId: "org-poc",
      proposalQuoteId: "quote-1",
      convertedAt: "2026-07-31T16:00:00.000Z",
    });
    expect(effects[0]?.payload).toMatchObject({
      preserveTenantAndData: true,
      liftCaps: true,
    });
    expect(addBusinessDays("2026-07-31T16:00:00.000Z", 5)).toBe(
      "2026-08-07T16:00:00.000Z",
    );
    expect(() =>
      planPocConversion({
        poc,
        paidOrderId: "order-1",
        paidOrganizationId: "org-new",
        proposalQuoteId: "quote-1",
        convertedAt: "2026-07-31T16:00:00.000Z",
      }),
    ).toThrow("POC_CONVERSION_MUST_PRESERVE_ORGANIZATION");
  });
});
