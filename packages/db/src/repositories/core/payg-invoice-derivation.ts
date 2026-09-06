import { z } from "zod";
import type { RuntimeTransaction } from "../../client";
import { loadPaygInvoiceSource } from "./payg-invoice-source";

export interface PaygInvoiceDerivation {
  billingSource: "payg";
  invoiceId: string;
  accountId: string;
  reference: string;
  status: string;
  currency: string;
  invoicedTotalMinor: string;
  invoicedNetTotalMinor: string;
  taxMinor: string;
  month: string;
  revision: number;
  kind: "invoice" | "debit_adjustment";
  serviceStartsAt: string;
  serviceEndsAt: string;
  supplierName: string;
  customerName: string;
  sku: string;
  region: string;
  policyVersion: number;
  storageByteHours: string;
  egressBytes: string;
  apiOperations: string;
  lines: readonly { kind: string; minor: string }[];
  taxLines: readonly {
    jurisdiction: string;
    treatment: string;
    notation: string;
    taxMinor: string;
  }[];
}
const PresentationSchema = z.object({
  supplier: z.object({ legalName: z.string() }),
  customer: z.object({ legalName: z.string() }),
  effect: z.object({
    kind: z.enum(["invoice", "debit_adjustment"]),
    amount: z.object({ minor: z.string() }),
  }),
  rating: z.object({
    period: z.object({
      serviceStartsAt: z.string(),
      serviceEndsAt: z.string(),
    }),
    binding: z.object({ sku: z.string(), region: z.string() }),
    policy: z.object({ version: z.number().int().positive() }),
    storageByteHours: z.string(),
    egressBytes: z.string(),
    apiOperations: z.string(),
    lines: z.array(
      z.object({ kind: z.string(), amount: z.object({ minor: z.string() }) }),
    ),
  }),
  taxDetermination: z.object({
    detail: z.object({
      lines: z.array(
        z.object({
          jurisdiction: z.string(),
          treatment: z.string(),
          notation: z.string(),
          taxMinor: z.string(),
        }),
      ),
    }),
  }),
});
export async function derivePaygInvoice(
  transaction: RuntimeTransaction,
  invoice: Parameters<typeof loadPaygInvoiceSource>[1] & {
    stripeInvoiceId: string | null;
    status: string;
  },
): Promise<PaygInvoiceDerivation> {
  const source = await loadPaygInvoiceSource(transaction, invoice);
  const snapshot = PresentationSchema.parse(source.sourceSnapshot);
  const { rating } = snapshot;
  return {
    billingSource: "payg",
    invoiceId: invoice.id,
    accountId: invoice.accountId,
    reference: invoice.stripeInvoiceId ?? invoice.id,
    status: invoice.status,
    currency: invoice.currency,
    invoicedTotalMinor: invoice.amountMinor.toString(),
    invoicedNetTotalMinor: (invoice.amountMinor - invoice.taxMinor).toString(),
    taxMinor: invoice.taxMinor.toString(),
    month: source.paygSource.month,
    revision: source.paygSource.revision,
    kind: snapshot.effect.kind,
    serviceStartsAt: rating.period.serviceStartsAt,
    serviceEndsAt: rating.period.serviceEndsAt,
    supplierName: snapshot.supplier.legalName,
    customerName: snapshot.customer.legalName,
    sku: rating.binding.sku,
    region: rating.binding.region,
    policyVersion: rating.policy.version,
    storageByteHours: rating.storageByteHours,
    egressBytes: rating.egressBytes,
    apiOperations: rating.apiOperations,
    lines:
      snapshot.effect.kind === "debit_adjustment"
        ? [
            {
              kind: "correction_adjustment",
              minor: snapshot.effect.amount.minor,
            },
          ]
        : rating.lines.map((line) => ({
            kind: line.kind,
            minor: line.amount.minor,
          })),
    taxLines: snapshot.taxDetermination.detail.lines,
  };
}
