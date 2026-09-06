import { describe, expect, it } from "vitest";
import {
  applyPaygOfferCommand,
  PaygOfferTermsSchema,
  type PaygOfferRecord,
} from "./offers";

const terms = PaygOfferTermsSchema.parse({
  name: "PAYG qualification",
  sku: "OBJECT_PAYG",
  region: "france",
  version: 1,
  effectiveFrom: "2026-09-01",
  sourceUri: "https://docs.fil.one/billing/trial",
  sourceCheckedAt: "2026-09-01T00:00:00.000Z",
  sourceDocumentId: "source",
  owner: "Finance",
  payg: {
    currency: "USD",
    storageTbMonthMinor: "499",
    monthlyMinimumMinor: "499",
    partialMonthMinimum: "full",
    correctionWindowDays: 90,
    aggregation: "hourly_average_daily_utc",
    egressRateMinor: "0",
    apiRateMinor: "0",
    stripeTaxCode: "txcd_10103001",
    qboIncomeAccount: "4000-Storage",
  },
  trial: {
    durationDays: 30,
    gracePeriodDays: 7,
    storageLimitBytes: "1000000000000",
    cumulativeEgressLimitBytes: "2000000000000",
    maximumCounterAgeSeconds: 60,
    egressExhaustion: "disable_all",
  },
});
const creator = "10000000-0000-4000-8000-000000000001";
const approver = "10000000-0000-4000-8000-000000000002";
const now = "2026-09-02T00:00:00.000Z";
const draft: PaygOfferRecord = {
  id: "20000000-0000-4000-8000-000000000001",
  rowVersion: 1,
  status: "draft",
  terms,
  createdBy: creator,
  lastEditedBy: creator,
  proposedBy: null,
  approvedBy: null,
  approvalEvidenceId: null,
  decisionReason: "",
  createdAt: now,
  updatedAt: now,
};
const proposed = applyPaygOfferCommand({
  current: draft,
  command: {
    action: "propose",
    id: draft.id,
    expectedRowVersion: 1,
    reason: "Ready for finance review",
  },
  userId: creator,
  now,
});

describe("PAYG offer policy approval", () => {
  it("requires a distinct approver and immutable approved version", () => {
    const command = {
      action: "approve" as const,
      id: draft.id,
      expectedRowVersion: 2,
      reason: "Approved economics and terms",
      approvalEvidenceId: "signed-decision",
    };
    expect(() =>
      applyPaygOfferCommand({
        current: proposed,
        command,
        userId: creator,
        now,
      }),
    ).toThrow("PAYG_OFFER_DISTINCT_APPROVER_REQUIRED");
    const approved = applyPaygOfferCommand({
      current: proposed,
      command,
      userId: approver,
      now,
    });
    expect(approved.status).toBe("approved");
    expect(approved.terms).toEqual(terms);
    expect(() =>
      applyPaygOfferCommand({
        current: approved,
        command: {
          action: "save",
          id: draft.id,
          expectedRowVersion: 3,
          terms: {
            ...terms,
            payg: { ...terms.payg, monthlyMinimumMinor: "999" },
          },
        },
        userId: creator,
        now,
      }),
    ).toThrow("PAYG_OFFER_NOT_DRAFT");
  });
  it("rejects stale writes, freezes proposed terms, and supports reasoned return to draft", () => {
    expect(() =>
      applyPaygOfferCommand({
        current: proposed,
        command: { action: "save", id: draft.id, expectedRowVersion: 1, terms },
        userId: creator,
        now,
      }),
    ).toThrow("PAYG_OFFER_STALE_VERSION");
    expect(() =>
      applyPaygOfferCommand({
        current: proposed,
        command: { action: "save", id: draft.id, expectedRowVersion: 2, terms },
        userId: creator,
        now,
      }),
    ).toThrow("PAYG_OFFER_NOT_DRAFT");
    expect(
      applyPaygOfferCommand({
        current: proposed,
        command: {
          action: "reject",
          id: draft.id,
          expectedRowVersion: 2,
          reason: "Missing COGS evidence",
        },
        userId: approver,
        now,
      }),
    ).toMatchObject({
      status: "draft",
      proposedBy: null,
      decisionReason: "Missing COGS evidence",
    });
  });
  it("rejects secret-bearing evidence URLs and unsupported policies", () => {
    for (const sourceUri of [
      "https://docs.fil.one/policy?token=secret",
      "https://user:password@docs.fil.one/policy",
      "http://docs.fil.one/policy",
    ])
      expect(
        PaygOfferTermsSchema.safeParse({ ...terms, sourceUri }).success,
      ).toBe(false);
    expect(
      PaygOfferTermsSchema.safeParse({
        ...terms,
        payg: { ...terms.payg, egressRateMinor: "1" },
      }).success,
    ).toBe(false);
  });
});
