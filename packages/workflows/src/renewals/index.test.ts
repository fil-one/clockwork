import { describe, expect, it } from "vitest";

import {
  evaluateAutoRenewal,
  localDateTimeToUtc,
  planTermAlerts,
  renewalRecipients,
} from "./index";

const term = {
  orderId: "order-1",
  accountId: "account-1",
  version: 1,
  startsOn: "2026-01-01",
  endsOn: "2026-11-02",
  noticeOn: "2026-10-01",
  timeZone: "America/New_York",
  renewalType: "auto_renew" as const,
  sourcing: "resale" as const,
  invoicingAccountId: "partner-1",
  partnerAccountId: "partner-1",
  pinnedAgreementVersion: 4,
};

describe("renewal workflows", () => {
  it("keeps 9am local across DST boundaries", () => {
    expect(localDateTimeToUtc("2026-03-07", "America/New_York")).toBe(
      "2026-03-07T14:00:00.000Z",
    );
    expect(localDateTimeToUtc("2026-03-09", "America/New_York")).toBe(
      "2026-03-09T13:00:00.000Z",
    );
  });

  it("routes resale commercial notices only to the partner", () => {
    expect(
      renewalRecipients({
        sourcing: "resale",
        clientRecipients: ["end-client@example.test"],
        partnerRecipients: ["partner@example.test"],
        internalOwner: "owner@example.test",
      }),
    ).toEqual({
      commercial: ["partner@example.test"],
      internal: ["owner@example.test"],
    });
  });

  it("plans both commercial and internal alerts with unique keys", () => {
    const effects = planTermAlerts({
      term,
      now: "2026-10-04T16:00:00.000Z",
      alertDaysBeforeNotice: [0],
      alertDaysBeforeEnd: [30],
      clientRecipients: ["end-client@example.test"],
      partnerRecipients: ["partner@example.test"],
      internalOwner: "owner@example.test",
    });
    expect(effects).toHaveLength(4);
    expect(new Set(effects.map((effect) => effect.idempotencyKey)).size).toBe(
      4,
    );
    expect(effects[0]?.payload).toMatchObject({
      recipients: ["partner@example.test"],
    });
  });

  it("blocks auto-renew for a timely notice and pins unchanged versions", () => {
    expect(
      evaluateAutoRenewal({
        term,
        notices: [
          {
            noticeId: "notice-1",
            type: "non_renewal",
            servedOn: "2026-09-30",
            evidenceDocumentId: "document-1",
          },
        ],
        now: "2026-11-03T16:00:00.000Z",
        agreementChanged: false,
        riskBlocked: false,
      }),
    ).toEqual({
      allowed: false,
      reason: "TIMELY_NOTICE_RECEIVED",
      agreementVersion: 4,
    });
    expect(
      evaluateAutoRenewal({
        term,
        notices: [],
        now: "2026-11-03T16:00:00.000Z",
        agreementChanged: false,
        riskBlocked: false,
      }),
    ).toEqual({
      allowed: true,
      reason: "AUTO_RENEW_ALLOWED",
      agreementVersion: 4,
    });
  });
});
