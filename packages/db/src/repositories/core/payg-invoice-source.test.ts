import { describe, expect, it, vi } from "vitest";
import type { RuntimeTransaction } from "../../client";
import { derivePaygInvoice } from "./payg-invoice-derivation";
import { loadPaygInvoiceSource } from "./payg-invoice-source";

const accountId = "10000000-0000-4000-8000-000000000001";
const enrollmentId = "20000000-0000-4000-8000-000000000001";
const supplierId = "30000000-0000-4000-8000-000000000001";
const invoice = {
  id: "40000000-0000-4000-8000-000000000001",
  billingSource: "payg",
  orderId: null,
  paygEffectKey: "payg:aug:revision2",
  accountId,
  currency: "USD",
  amountMinor: 120n,
  taxMinor: 20n,
  taxTreatment: "standard",
};
const snapshot = {
  effect: {
    idempotencyKey: invoice.paygEffectKey,
    enrollmentId,
    accountId,
    month: "2026-08",
    revision: 2,
    kind: "debit_adjustment",
    amount: { currency: "USD", minor: "100" },
    ratingEvidenceHash: "a".repeat(64),
  },
  rating: { evidenceHash: "a".repeat(64), binding: { accountId } },
  supplier: { legalEntityId: supplierId },
  customer: { accountId, invoiceDeliveryEmail: "ap@buyer.test" },
  stripeCustomerId: "cus_pinned",
  taxDetermination: {
    currency: "USD",
    netMinor: "100",
    taxMinor: "20",
    treatment: "standard",
    detail: {
      confidence: "determined",
      reviewReasons: [],
      supplierLegalEntityId: supplierId,
      customerAccountId: accountId,
    },
  },
};
function transaction(source: unknown = snapshot) {
  return {
    execute: vi.fn().mockResolvedValue(
      source === null
        ? []
        : [
            {
              enrollment_id: enrollmentId,
              effect_key: invoice.paygEffectKey,
              source_snapshot: source,
            },
          ],
    ),
  } as unknown as RuntimeTransaction;
}
describe("retained PAYG invoice source", () => {
  it("presents a correction delta separately from the complete rerated month", async () => {
    const complete = {
      ...snapshot,
      supplier: { ...snapshot.supplier, legalName: "Supplier" },
      customer: { ...snapshot.customer, legalName: "Buyer" },
      rating: {
        ...snapshot.rating,
        binding: {
          ...snapshot.rating.binding,
          sku: "STANDARD-STORAGE",
          region: "eu-west",
        },
        policy: { version: 1 },
        period: {
          serviceStartsAt: "2026-08-01T00:00:00.000Z",
          serviceEndsAt: "2026-09-01T00:00:00.000Z",
        },
        storageByteHours: "1000000000000",
        egressBytes: "0",
        apiOperations: "0",
        lines: [{ kind: "storage_bytes", amount: { minor: "900" } }],
      },
      taxDetermination: {
        ...snapshot.taxDetermination,
        detail: {
          ...snapshot.taxDetermination.detail,
          lines: [
            {
              jurisdiction: "GB",
              treatment: "standard",
              notation: "",
              taxMinor: "20",
            },
          ],
        },
      },
    };
    const result = await derivePaygInvoice(transaction(complete), {
      ...invoice,
      stripeInvoiceId: "in_payg",
      status: "open",
    });
    expect(result).toMatchObject({
      billingSource: "payg",
      reference: "in_payg",
      invoicedTotalMinor: "120",
      invoicedNetTotalMinor: "100",
      lines: [{ kind: "correction_adjustment", minor: "100" }],
      supplierName: "Supplier",
      policyVersion: 1,
    });
    expect(result).not.toHaveProperty("orderId");
  });

  it("reads the correction delta, pinned customer and explicit PAYG identity without a term order", async () => {
    await expect(
      loadPaygInvoiceSource(transaction(), invoice),
    ).resolves.toMatchObject({
      paygSource: {
        kind: "payg",
        enrollmentId,
        effectKey: invoice.paygEffectKey,
        month: "2026-08",
        revision: 2,
      },
      customerId: "cus_pinned",
      apEmail: "ap@buyer.test",
    });
  });
  it("refuses missing sources, amount drift, source switching and tax needing review", async () => {
    await expect(
      loadPaygInvoiceSource(transaction(null), invoice),
    ).rejects.toThrow("PAYG_INVOICE_SOURCE_MISSING");
    await expect(
      loadPaygInvoiceSource(transaction(), { ...invoice, amountMinor: 1000n }),
    ).rejects.toThrow("PAYG_INVOICE_SOURCE_TRUTH_MISMATCH");
    await expect(
      loadPaygInvoiceSource(transaction(), { ...invoice, orderId: supplierId }),
    ).rejects.toThrow("PAYG_INVOICE_SOURCE_BINDING_INVALID");
    await expect(
      loadPaygInvoiceSource(
        transaction({
          ...snapshot,
          taxDetermination: {
            ...snapshot.taxDetermination,
            detail: {
              ...snapshot.taxDetermination.detail,
              confidence: "review_required",
            },
          },
        }),
        invoice,
      ),
    ).rejects.toThrow();
  });
  it("rejects foreign customers, forged rating evidence and credit effects in invoice dispatch", async () => {
    for (const effect of [
      { ...snapshot.effect, accountId: supplierId },
      { ...snapshot.effect, ratingEvidenceHash: "b".repeat(64) },
      { ...snapshot.effect, kind: "credit_adjustment" },
    ]) {
      await expect(
        loadPaygInvoiceSource(transaction({ ...snapshot, effect }), invoice),
      ).rejects.toThrow();
    }
  });
});
