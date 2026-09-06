import type { SessionClaims } from "@clockwork/api";
import { canonicalTaxHash, type RuntimeTransaction } from "@clockwork/db";
import { describe, expect, it, vi } from "vitest";
import { resolveArtifactSource } from "./artifact-sources";

const accountId = "10000000-0000-4000-8000-000000000001";
const invoiceId = "20000000-0000-4000-8000-000000000001";
const enrollmentId = "30000000-0000-4000-8000-000000000001";
const supplierId = "40000000-0000-4000-8000-000000000001";
const address = {
  line1: "1 Main Street",
  city: "London",
  postalCode: "SW1A 1AA",
  country: "GB",
};
const snapshot = {
  supplier: {
    legalEntityId: supplierId,
    legalName: "Retained Supplier",
    registeredAddress: address,
  },
  customer: {
    accountId,
    legalName: "Retained Buyer",
    registeredAddress: address,
    invoiceDeliveryEmail: "ap@buyer.test",
  },
  stripeCustomerId: "cus_retained",
  effect: {
    kind: "debit_adjustment",
    idempotencyKey: "payg-correction",
    enrollmentId,
    accountId,
    month: "2026-08",
    revision: 2,
    amount: { currency: "GBP", minor: "100" },
    ratingEvidenceHash: "a".repeat(64),
  },
  rating: {
    evidenceHash: "a".repeat(64),
    binding: { accountId },
    period: {
      serviceStartsAt: "2026-08-01T00:00:00.000Z",
      serviceEndsAt: "2026-09-01T00:00:00.000Z",
    },
    lines: [{ kind: "storage_bytes", amount: { minor: "900" } }],
  },
  taxDetermination: {
    currency: "GBP",
    netMinor: "100",
    taxMinor: "20",
    treatment: "standard",
    detail: {
      confidence: "determined",
      reviewReasons: [],
      supplierLegalEntityId: supplierId,
      customerAccountId: accountId,
      lines: [
        {
          jurisdiction: "GB",
          treatment: "standard",
          notation: "VAT",
          taxMinor: "20",
        },
      ],
    },
  },
};
const row = {
  id: invoiceId,
  account_id: accountId,
  billing_source: "payg",
  payg_effect_key: "payg-correction",
  currency: "GBP",
  amount_minor: "120",
  tax_minor: "20",
  tax_treatment: "standard",
  paid_minor: "120",
  paid_at: "2026-09-02T00:00:00.000Z",
  payment_reference: "pi_retained",
  stripe_invoice_id: "in_retained",
  status: "paid",
  row_version: 3,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-02T00:00:00.000Z",
  source_snapshot: snapshot,
  source_hash: canonicalTaxHash(snapshot),
};
const session: SessionClaims = {
  userId: supplierId,
  roles: [],
  mfaVerified: true,
  recentAuthenticationVerified: true,
  accountIds: [accountId],
  isInternalStaff: false,
};
function tx(overrides: Partial<typeof row> = {}) {
  return {
    execute: vi
      .fn()
      .mockResolvedValueOnce([{ ...row, ...overrides }])
      .mockResolvedValueOnce([
        {
          enrollment_id: enrollmentId,
          effect_key: "payg-correction",
          source_snapshot: snapshot,
        },
      ]),
  } as unknown as RuntimeTransaction;
}
const request = {
  kind: "receipt" as const,
  subjectId: invoiceId,
  expectedVersion: "3:payg:2",
  audience: "customer" as const,
  accountId,
};
describe("retained PAYG invoice documents", () => {
  it("renders receipt facts from the pinned parties and correction delta without a term reference", async () => {
    const resolved = await resolveArtifactSource(tx(), session, request);
    expect(resolved.input).toMatchObject({
      kind: "receipt",
      billingPeriodReference: "PAYG 2026-08 · revision 2",
      issuer: { legalName: "Retained Supplier" },
      recipient: { legalName: "Retained Buyer" },
      lineItems: [
        { description: "Correction adjustment", amount: { minorUnits: "100" } },
      ],
      totals: { total: { minorUnits: "120" } },
      paymentReference: "pi_retained",
    });
    expect(resolved.input).not.toHaveProperty("orderReference");
  });
  it("refuses corrupt snapshots, unpaid receipts and foreign account requests", async () => {
    await expect(
      resolveArtifactSource(
        tx({ source_hash: "b".repeat(64) }),
        session,
        request,
      ),
    ).rejects.toThrow("ARTIFACT_SOURCE_CORRUPT");
    await expect(
      resolveArtifactSource(tx({ paid_minor: "0" }), session, request),
    ).rejects.toThrow(
      "A receipt requires authoritative successful payment evidence",
    );
    await expect(
      resolveArtifactSource(tx(), { ...session, accountIds: [] }, request),
    ).rejects.toThrow(
      "The artifact source is outside the authorized audience scope",
    );
  });
});
