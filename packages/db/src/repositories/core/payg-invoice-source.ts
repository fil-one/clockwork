import { sql } from "drizzle-orm";
import { z } from "zod";
import { MoneySchema, PaygInvoiceSourceSchema } from "@clockwork/contracts";
import type { RuntimeTransaction } from "../../client";

const SnapshotSchema = z.object({
  effect: z.object({
    idempotencyKey: z.string().min(1),
    enrollmentId: z.uuid(),
    accountId: z.uuid(),
    month: z.string(),
    revision: z.number().int().positive(),
    kind: z.enum(["invoice", "debit_adjustment"]),
    amount: MoneySchema,
    ratingEvidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  rating: z.object({
    evidenceHash: z.string(),
    binding: z.object({ accountId: z.uuid() }),
  }),
  supplier: z.object({ legalEntityId: z.uuid() }),
  customer: z.object({ accountId: z.uuid(), invoiceDeliveryEmail: z.email() }),
  stripeCustomerId: z.string().min(1),
  taxDetermination: z.object({
    currency: z.string(),
    netMinor: z.string().regex(/^\d+$/),
    taxMinor: z.string().regex(/^\d+$/),
    treatment: z.string(),
    detail: z.object({
      confidence: z.literal("determined"),
      reviewReasons: z.array(z.string()).length(0),
      supplierLegalEntityId: z.uuid(),
      customerAccountId: z.uuid(),
    }),
  }),
});

/** Reads the immutable PAYG financial source, without inventing a term order. */
export async function loadPaygInvoiceSource(
  transaction: RuntimeTransaction,
  invoice: {
    id: string;
    billingSource: string;
    orderId: string | null;
    paygEffectKey: string | null;
    accountId: string;
    currency: string;
    amountMinor: bigint;
    taxMinor: bigint;
    taxTreatment: string;
  },
) {
  if (
    invoice.billingSource !== "payg" ||
    invoice.orderId !== null ||
    !invoice.paygEffectKey
  )
    throw new Error("PAYG_INVOICE_SOURCE_BINDING_INVALID");
  const rows = await transaction.execute(sql`
    select enrollment_id, effect_key, source_snapshot from core_payg_invoice_sources
    where invoice_id = ${invoice.id}
  `);
  const row = rows[0];
  if (!row) throw new Error("PAYG_INVOICE_SOURCE_MISSING");
  const snapshot = SnapshotSchema.parse(row.source_snapshot);
  const { effect, taxDetermination: tax } = snapshot;
  if (
    row.effect_key !== invoice.paygEffectKey ||
    effect.idempotencyKey !== invoice.paygEffectKey ||
    row.enrollment_id !== effect.enrollmentId ||
    effect.accountId !== invoice.accountId ||
    snapshot.customer.accountId !== invoice.accountId ||
    snapshot.rating.binding.accountId !== invoice.accountId ||
    effect.ratingEvidenceHash !== snapshot.rating.evidenceHash ||
    effect.amount.currency !== invoice.currency ||
    tax.currency !== invoice.currency ||
    BigInt(effect.amount.minor) !== BigInt(tax.netMinor) ||
    BigInt(tax.taxMinor) !== invoice.taxMinor ||
    tax.treatment !== invoice.taxTreatment ||
    BigInt(tax.netMinor) + BigInt(tax.taxMinor) !== invoice.amountMinor ||
    tax.detail.supplierLegalEntityId !== snapshot.supplier.legalEntityId ||
    tax.detail.customerAccountId !== invoice.accountId
  )
    throw new Error("PAYG_INVOICE_SOURCE_TRUTH_MISMATCH");
  return {
    paygSource: PaygInvoiceSourceSchema.parse({
      kind: "payg",
      enrollmentId: effect.enrollmentId,
      effectKey: effect.idempotencyKey,
      month: effect.month,
      revision: effect.revision,
    }),
    customerId: snapshot.stripeCustomerId,
    apEmail: snapshot.customer.invoiceDeliveryEmail,
    sourceSnapshot: row.source_snapshot,
  };
}
