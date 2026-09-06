import { expect, it } from "vitest";
import {
  CustomerAcquisitionCommandSchema,
  CustomerAcquisitionPolicySchema,
  customerAcquisitionOffer,
  effectiveCustomerOffers,
} from "./acquisition";
import { PaygOfferRecordSchema } from "./offers";
const notices = {
  paygRequestsEnabled: true,
  trialRequestsEnabled: true,
  serviceNotice: "Service starts only after verified handoff.",
  cancellationNotice: "Cancellation needs a confirmed provider service end.",
  trialNotice: "Trial eligibility is retained for the verified organization.",
  terms: {
    documentId: "terms",
    version: "1",
    uri: "https://example.test/terms",
    sha256: "a".repeat(64),
  },
  retention: {
    documentId: "retention",
    version: "1",
    uri: "https://example.test/retention",
    sha256: "b".repeat(64),
  },
};
const source = PaygOfferRecordSchema.parse({
  id: "61000000-0000-4000-8000-000000000001",
  rowVersion: 3,
  status: "approved",
  createdBy: "21000000-0000-4000-8000-000000000001",
  lastEditedBy: "21000000-0000-4000-8000-000000000001",
  proposedBy: "21000000-0000-4000-8000-000000000001",
  approvedBy: "21000000-0000-4000-8000-000000000002",
  approvalEvidenceId: "verified-policy",
  decisionReason: "Approved policy",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  terms: {
    name: "Usage storage",
    sku: "STORAGE",
    region: "us-east-2",
    version: 1,
    effectiveFrom: "2026-09-01",
    sourceUri: "https://example.test/evidence",
    sourceCheckedAt: "2026-09-01T00:00:00.000Z",
    sourceDocumentId: "policy",
    owner: "Commercial",
    customerAcquisition: notices,
    payg: {
      currency: "USD",
      storageTbMonthMinor: "499",
      monthlyMinimumMinor: "499",
      partialMonthMinimum: "full",
      correctionWindowDays: 30,
      aggregation: "hourly_average_daily_utc",
      egressRateMinor: "0",
      apiRateMinor: "0",
      stripeTaxCode: "storage",
      qboIncomeAccount: "4000",
    },
    trial: {
      durationDays: 30,
      gracePeriodDays: 7,
      storageLimitBytes: "1000000000000",
      cumulativeEgressLimitBytes: "2000000000000",
      maximumCounterAgeSeconds: 60,
      egressExhaustion: "disable_all",
    },
  },
});
it("offers only the latest approved effective policy and never falls back past disabled acquisition", () => {
  const future = {
    ...source,
    id: "61000000-0000-4000-8000-000000000002",
    terms: { ...source.terms, version: 2, effectiveFrom: "2026-10-01" },
  };
  expect(
    effectiveCustomerOffers([future, source], "2026-09-06T00:00:00.000Z").map(
      (row) => row.id,
    ),
  ).toEqual([source.id]);
  const disabled = {
    ...future,
    terms: {
      ...future.terms,
      effectiveFrom: "2026-09-05",
      customerAcquisition: {
        ...notices,
        paygRequestsEnabled: false,
        trialRequestsEnabled: false,
      },
    },
  };
  expect(
    effectiveCustomerOffers([source, disabled], "2026-09-06T00:00:00.000Z"),
  ).toEqual([]);
  expect(
    customerAcquisitionOffer(disabled, { includeDisabled: true })?.id,
  ).toBe(disabled.id);
});
it("pins document notices and economics in the acceptance fingerprint", () => {
  const initial = customerAcquisitionOffer(source);
  const changed = customerAcquisitionOffer({
    ...source,
    terms: {
      ...source.terms,
      customerAcquisition: {
        ...notices,
        terms: { ...notices.terms, sha256: "c".repeat(64) },
      },
    },
  });
  expect(initial?.fingerprint).not.toBe(changed?.fingerprint);
  expect(initial).not.toHaveProperty("qboIncomeAccount");
});
it("requires complete configured legal references without invented defaults", () => {
  expect(
    CustomerAcquisitionPolicySchema.safeParse({
      ...notices,
      terms: { ...notices.terms, sha256: "" },
    }).success,
  ).toBe(false);
  expect(
    CustomerAcquisitionPolicySchema.safeParse({
      ...notices,
      retention: { ...notices.retention, uri: "javascript:alert(1)" },
    }).success,
  ).toBe(false);
  const { customerAcquisition: _notices, ...terms } = source.terms;
  void _notices;
  expect(
    effectiveCustomerOffers([{ ...source, terms }], "2026-09-06T00:00:00.000Z"),
  ).toEqual([]);
});
it("accepts assent or cancellation without allowing provider/billing authority injection", () => {
  const command = {
    kind: "payg",
    id: "62000000-0000-4000-8000-000000000001",
    accountId: "11000000-0000-4000-8000-000000000001",
    organizationId: "31000000-0000-4000-8000-000000000001",
    offerVersionId: source.id,
    offerRowVersion: 3,
    offerFingerprint: customerAcquisitionOffer(source)?.fingerprint,
    acceptedTerms: true,
  };
  expect(CustomerAcquisitionCommandSchema.safeParse(command).success).toBe(
    true,
  );
  for (const patch of [
    { acceptedTerms: false },
    { billingAuthority: "clockwork" },
    { providerTenantId: "invented" },
    { offerFingerprint: "" },
  ])
    expect(
      CustomerAcquisitionCommandSchema.safeParse({ ...command, ...patch })
        .success,
    ).toBe(false);
});

it("reports malformed document URLs through validation without throwing", () => {
  expect(() =>
    CustomerAcquisitionPolicySchema.safeParse({
      ...notices,
      terms: { ...notices.terms, uri: "not a URL" },
    }),
  ).not.toThrow();
  expect(
    CustomerAcquisitionPolicySchema.safeParse({
      ...notices,
      terms: { ...notices.terms, uri: "not a URL" },
    }).success,
  ).toBe(false);
});
