import { describe, expect, it } from "vitest";

import { hashExactText, type ImmutableEvidenceObject } from "../agreements";
import {
  addCalendarDays,
  applyAmendment,
  assertRenewalRequestReady,
  buildRenewalCommandCenter,
  createAmendment,
  evaluateAutoRenewal,
  localDateTimeToInstant,
  prepopulateRenewalRequest,
  recordInboundNotice,
  recordRenewalDecline,
  renewalOperationIdempotencyKey,
  resolveRenewalAgreement,
  routeRenewalNotification,
  scheduleTermAlerts,
  type RenewableOrder,
} from ".";

const now = "2026-07-31T16:00:00.000Z";

function evidence(): ImmutableEvidenceObject {
  const sha256 = hashExactText("immutable notice evidence");
  return {
    documentId: "document-notice",
    kind: "other",
    sha256,
    storageKey: `sha256/${sha256}`,
    versionId: "version-notice-1",
    retainedUntil: "2036-07-31T16:00:00.000Z",
    legalHold: false,
    malwareScan: "clean",
    recordedAt: now,
  };
}

function order(overrides: Partial<RenewableOrder> = {}): RenewableOrder {
  return {
    orderId: "order-northstar-annual",
    accountId: "account-northstar",
    endClientAccountId: null,
    partnerAccountId: null,
    invoicingAccountId: "account-northstar",
    notificationPath: "direct",
    startsOn: "2026-08-01",
    endsOn: "2027-07-31",
    noticeDays: 60,
    renewalType: "auto_renew",
    timeZone: "America/New_York",
    pinnedAgreement: {
      agreementId: "agreement-csa-v1",
      templateId: "template-csa-v1",
      templateVersion: "1.0.0",
      textHash: "a".repeat(64),
    },
    lines: [
      {
        lineId: "line-storage-v1",
        sku: "storage-standard",
        quantity: "100",
        region: "us-east-2",
        unitPriceMinor: "900",
        currency: "USD",
      },
    ],
    commercialOwnerId: "owner-user",
    rowVersion: 1,
    ...overrides,
  };
}

describe("amendments preserve one order and one term clock", () => {
  it("supersedes lines instead of creating an overlapping service", () => {
    const amendment = createAmendment({
      amendmentId: "amendment-upgrade-1",
      parentOrderId: "order-northstar-annual",
      parentOrderVersion: 1,
      effectiveOn: "2027-01-01",
      kind: "upgrade",
      lines: [
        {
          amendmentLineId: "amendment-line-1",
          kind: "increase",
          supersededLineId: "line-storage-v1",
          resultingLine: {
            lineId: "line-storage-v2",
            sku: "storage-standard",
            quantity: "250",
            region: "us-east-2",
            unitPriceMinor: "850",
            currency: "USD",
          },
        },
      ],
      prorationMethod: "daily",
      prorationExplanation: null,
      resultingEndsOn: "2027-07-31",
      acceptanceEvidenceHash: "b".repeat(64),
      executedDocument: evidence(),
      createdAt: now,
    });
    const result = applyAmendment(order(), amendment);
    expect(result.orderId).toBe("order-northstar-annual");
    expect(result.rowVersion).toBe(2);
    expect(result.endsOn).toBe("2027-07-31");
    expect(result.lines).toEqual([
      expect.objectContaining({ lineId: "line-storage-v2", quantity: "250" }),
    ]);
    expect(order().lines[0]?.lineId).toBe("line-storage-v1");
  });

  it("supports explicit co-termination and rejects stale order versions", () => {
    const coTermination = createAmendment({
      amendmentId: "amendment-coterm-1",
      parentOrderId: "order-northstar-annual",
      parentOrderVersion: 2,
      effectiveOn: "2027-01-01",
      kind: "co_termination",
      lines: [],
      prorationMethod: "daily",
      prorationExplanation: null,
      resultingEndsOn: "2027-09-30",
      acceptanceEvidenceHash: "b".repeat(64),
      executedDocument: evidence(),
      createdAt: now,
    });
    expect(() => applyAmendment(order(), coTermination)).toThrow(
      "AMENDMENT_VERSION_CONFLICT",
    );
  });
});

describe("agreement pinning and renewal requests", () => {
  it("prepopulates an immutable request from the expiring order", () => {
    const source = order();
    const request = prepopulateRenewalRequest({
      requestId: "renewal-request-1",
      order: source,
      proposedEndsOn: "2028-07-31",
      createdAt: now,
    });
    expect(request).toMatchObject({
      sourceOrderId: source.orderId,
      sourceOrderVersion: 1,
      proposedStartsOn: "2027-08-01",
      proposedEndsOn: "2028-07-31",
      agreementUpgradeStatus: "pinned",
      agreement: { agreementId: "agreement-csa-v1" },
    });
    expect(request.lines).not.toBe(source.lines);
    expect(Object.isFrozen(request.lines)).toBe(true);
  });

  it("keeps auto-renewals pinned and permits an upgrade only with matching re-execution evidence", () => {
    const pinned = order().pinnedAgreement;
    const upgraded = {
      agreementId: "agreement-csa-v2",
      templateId: "template-csa-v2",
      templateVersion: "2.0.0",
      textHash: "c".repeat(64),
    };
    expect(() =>
      resolveRenewalAgreement({
        pinned,
        requested: upgraded,
        autoRenewal: true,
        reexecution: null,
      }),
    ).toThrow("AUTO_RENEWAL_MUST_KEEP_PINNED_AGREEMENT");
    expect(() =>
      resolveRenewalAgreement({
        pinned,
        requested: upgraded,
        autoRenewal: false,
        reexecution: null,
      }),
    ).toThrow("AGREEMENT_REEXECUTION_REQUIRED");
    expect(
      resolveRenewalAgreement({
        pinned,
        requested: upgraded,
        autoRenewal: false,
        reexecution: {
          priorAgreementId: pinned.agreementId,
          newAgreement: upgraded,
          executionEvidenceHash: "d".repeat(64),
          executedAt: "2027-06-15T14:00:00.000-04:00",
          reason: "template_upgrade",
        },
      }),
    ).toEqual(upgraded);

    const pending = prepopulateRenewalRequest({
      requestId: "renewal-request-upgrade",
      order: order(),
      proposedEndsOn: "2028-07-31",
      requestedAgreement: upgraded,
      createdAt: now,
    });
    expect(pending.agreementUpgradeStatus).toBe("reexecution_required");
    expect(() => assertRenewalRequestReady(pending)).toThrow(
      "AGREEMENT_REEXECUTION_REQUIRED",
    );
  });
});

describe("notice and decline evidence gate auto-renewal", () => {
  it("blocks for a timely immutable inbound notice", () => {
    const inbound = recordInboundNotice({
      noticeId: "notice-non-renewal-1",
      accountId: "account-northstar",
      orderId: "order-northstar-annual",
      type: "non_renewal",
      servedOn: "2027-05-31",
      receivedAt: "2027-06-01T13:00:00.000Z",
      recordedByUserId: "operator-user",
      deliveryChannel: "email",
      evidence: evidence(),
    });
    expect(inbound.immutableHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      evaluateAutoRenewal({
        order: order(),
        notices: [inbound],
        declines: [],
        screeningStatus: "clear",
        overdueInvoice: false,
        materialRiskHold: false,
      }),
    ).toEqual({
      outcome: "blocked",
      reasons: ["TIMELY_INBOUND_NOTICE"],
      noticeDeadline: "2027-06-01",
    });

    expect(() =>
      evaluateAutoRenewal({
        order: order(),
        notices: [{ ...inbound, servedOn: "2027-05-30" }],
        declines: [],
        screeningStatus: "clear",
        overdueInvoice: false,
        materialRiskHold: false,
      }),
    ).toThrow("INBOUND_NOTICE_HASH_MISMATCH");
  });

  it("records decline with acceptance-grade authority, identity, text, time, IP and UI evidence", () => {
    const decline = recordRenewalDecline({
      declineId: "decline-1",
      order: order(),
      legalEntityName: "Northstar Archive Ltd",
      userId: "user-owner",
      email: "OWNER@NORTHSTAR.TEST",
      role: "owner",
      authorityTitle: "Chief Executive Officer",
      authorityAttested: true,
      declinedAt: "2027-06-01T23:59:00.000-04:00",
      ipAddress: "192.0.2.55",
      uiContext: {
        route: "/orders/order-northstar-annual/renewal",
        action: "decline_renewal",
        sessionId: "session-renewal",
        requestId: "request-renewal",
        userAgent: "Clockwork test browser",
      },
      exactDeclineText:
        "Northstar Archive Ltd declines renewal of order-northstar-annual.",
    });
    expect(decline).toMatchObject({
      email: "owner@northstar.test",
      servedOn: "2027-06-01",
      timeliness: "timely",
      authorityAttestation: "I am authorized to bind Northstar Archive Ltd",
    });
    expect(decline.exactDeclineTextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(decline.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      evaluateAutoRenewal({
        order: order(),
        notices: [],
        declines: [decline],
        screeningStatus: "clear",
        overdueInvoice: false,
        materialRiskHold: false,
      }).outcome,
    ).toBe("blocked");
  });

  it("holds late notices and screening reviews for legal review, while hard risk gates block", () => {
    const late = recordInboundNotice({
      noticeId: "notice-late-1",
      accountId: "account-northstar",
      orderId: "order-northstar-annual",
      type: "non_renewal",
      servedOn: "2027-06-02",
      receivedAt: "2027-06-02T13:00:00.000Z",
      recordedByUserId: "operator-user",
      deliveryChannel: "email",
      evidence: evidence(),
    });
    expect(
      evaluateAutoRenewal({
        order: order(),
        notices: [late],
        declines: [],
        screeningStatus: "review",
        overdueInvoice: false,
        materialRiskHold: false,
      }),
    ).toMatchObject({
      outcome: "legal_review",
      reasons: ["LATE_INBOUND_NOTICE", "SCREENING_REVIEW"],
    });
    expect(
      evaluateAutoRenewal({
        order: order(),
        notices: [],
        declines: [],
        screeningStatus: "clear",
        overdueInvoice: true,
        materialRiskHold: false,
      }).outcome,
    ).toBe("blocked");
  });
});

describe("time-zone and DST-correct term alerts", () => {
  it("shifts a nonexistent spring-forward wall time to the first valid minute", () => {
    expect(
      localDateTimeToInstant("2026-03-08", "02:30", "America/New_York"),
    ).toBe("2026-03-08T07:00:00.000Z");
  });

  it("makes the fall-back ambiguity deterministic", () => {
    expect(
      localDateTimeToInstant(
        "2026-11-01",
        "01:30",
        "America/New_York",
        "earlier",
      ),
    ).toBe("2026-11-01T05:30:00.000Z");
    expect(
      localDateTimeToInstant(
        "2026-11-01",
        "01:30",
        "America/New_York",
        "later",
      ),
    ).toBe("2026-11-01T06:30:00.000Z");
  });

  it("schedules by contractual calendar date with stable external-effect keys", () => {
    const alerts = scheduleTermAlerts({
      order: order({
        startsOn: "2025-03-11",
        endsOn: "2026-03-10",
        noticeDays: 0,
      }),
      beforeNoticeDays: [],
      beforeEndDays: [2],
      localSendTime: "02:30",
      notBeforeInstant: "2026-01-01T00:00:00.000Z",
    });
    expect(alerts).toEqual([
      expect.objectContaining({
        kind: "before_end",
        localDate: "2026-03-08",
        scheduledFor: "2026-03-08T07:00:00.000Z",
        idempotencyKey:
          "renewal-alert:order-northstar-annual:before_end:2026-03-08",
      }),
    ]);
    expect(
      scheduleTermAlerts({
        order: order({
          startsOn: "2025-03-11",
          endsOn: "2026-03-10",
          noticeDays: 0,
        }),
        beforeNoticeDays: [],
        beforeEndDays: [2],
        localSendTime: "02:30",
        notBeforeInstant: "2026-01-01T00:00:00.000Z",
      })[0]?.idempotencyKey,
    ).toBe(alerts[0]?.idempotencyKey);
  });
});

describe("notification privacy and renewal command center", () => {
  it("routes partner-sourced commerce only to the partner with an allow-listed payload", () => {
    const partnerOrder = order({
      accountId: "account-end-client",
      endClientAccountId: "account-end-client",
      partnerAccountId: "account-partner",
      invoicingAccountId: "account-partner",
      notificationPath: "partner",
    });
    const routed = routeRenewalNotification({
      order: partnerOrder,
      directContacts: ["buyer@end-client.test"],
      partnerContacts: ["renewals@partner.test"],
      endClientContacts: ["admin@end-client.test"],
      internalOwnerEmail: "owner@filone.test",
      endClientDisplayName: "Northstar Archive Ltd",
      actionUrl: "https://portal.partner.test/renewals/order-northstar-annual",
      transferPriceMinor: "900000",
      marginBasisPoints: 4200,
    } as Parameters<typeof routeRenewalNotification>[0] & {
      transferPriceMinor: string;
      marginBasisPoints: number;
    });
    expect(routed.commercialRecipients).toEqual(["renewals@partner.test"]);
    expect(routed.endClientRecipients).toEqual([]);
    expect(routed.payload).toEqual({
      orderReference: "order-northstar-annual",
      endClientDisplayName: "Northstar Archive Ltd",
      endsOn: "2027-07-31",
      noticeDeadline: "2027-06-01",
      actionUrl: "https://portal.partner.test/renewals/order-northstar-annual",
    });
    expect(JSON.stringify(routed)).not.toContain("900000");
    expect(JSON.stringify(routed)).not.toContain("4200");
  });

  it("keeps direct renewals direct and never sends commercial mail to an end-client list", () => {
    const routed = routeRenewalNotification({
      order: order(),
      directContacts: ["buyer@northstar.test"],
      partnerContacts: [],
      endClientContacts: ["unrelated@end-client.test"],
      internalOwnerEmail: "owner@filone.test",
      endClientDisplayName: null,
      actionUrl: "https://commerce.filone.test/renewals/order-northstar-annual",
    });
    expect(routed.commercialRecipients).toEqual(["buyer@northstar.test"]);
    expect(routed.endClientRecipients).toEqual([]);
  });

  it("sorts actionable expiry buckets and scores explainable risk signals", () => {
    const rows = buildRenewalCommandCenter({
      asOfDate: "2027-05-31",
      items: [
        {
          order: order(),
          segment: "direct",
          signals: {
            openSupportIssueCount: 3,
            highestSupportSeverity: "critical",
            usageChangeBasisPoints: -3000,
            overdueInvoiceDays: 21,
            portalInactivityDays: 90,
            partnerHasActed: null,
            unresolvedNotice: true,
          },
          lastTouchAt: "2027-05-01T14:00:00.000Z",
          status: "at_risk",
        },
        {
          order: order({ orderId: "order-later", endsOn: "2027-12-31" }),
          segment: "partner_sourced",
          signals: {
            openSupportIssueCount: 0,
            highestSupportSeverity: "none",
            usageChangeBasisPoints: 500,
            overdueInvoiceDays: 0,
            portalInactivityDays: 3,
            partnerHasActed: true,
            unresolvedNotice: false,
          },
          lastTouchAt: null,
          status: "contacted",
        },
      ],
    });
    expect(rows[0]).toMatchObject({
      orderId: "order-northstar-annual",
      bucket: "31_90",
      daysToExpiry: 61,
      riskLevel: "critical",
      status: "at_risk",
    });
    expect(rows[0]?.riskReasons).toEqual(
      expect.arrayContaining([
        "SUPPORT_CRITICAL",
        "DECLINING_USAGE",
        "OVERDUE_INVOICE",
        "UNRESOLVED_NOTICE",
      ]),
    );
    expect(rows[1]).toMatchObject({ orderId: "order-later", bucket: "later" });
  });

  it("derives repeatable workflow idempotency keys from aggregate/version/operation only", () => {
    const first = renewalOperationIdempotencyKey({
      aggregateType: "order",
      aggregateId: "order-northstar-annual",
      version: 2,
      operation: "send_notice",
    });
    expect(
      renewalOperationIdempotencyKey({
        aggregateType: "order",
        aggregateId: "order-northstar-annual",
        version: 2,
        operation: "send_notice",
      }),
    ).toBe(first);
    expect(first).not.toBe(
      renewalOperationIdempotencyKey({
        aggregateType: "order",
        aggregateId: "order-northstar-annual",
        version: 3,
        operation: "send_notice",
      }),
    );
  });
});

describe("calendar helpers", () => {
  it("uses calendar days across leap years", () => {
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addCalendarDays("2028-02-29", 1)).toBe("2028-03-01");
  });
});
