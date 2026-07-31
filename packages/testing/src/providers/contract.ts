import type { BillingPort } from "@clockwork/contracts";
import { ids, IdempotencyKeySchema, MoneySchema } from "@clockwork/contracts";
import { describe, expect, it } from "vitest";

export function billingProviderContract(
  name: string,
  create: () => BillingPort,
) {
  describe(`${name} billing provider contract`, () => {
    it("honors idempotent invoice references", async () => {
      const adapter = create();
      const input = {
        invoiceId: ids.invoice.parse("90000000-0000-4000-8000-000000000001"),
        customerId: "cus_contract",
        orderId: ids.order.parse("80000000-0000-4000-8000-000000000001"),
        amount: MoneySchema.parse({ currency: "USD", minor: "1000" }),
        poNumber: "PO-CONTRACT",
        idempotencyKey: IdempotencyKeySchema.parse("invoice:contract:0001"),
      };
      const first = await adapter.issueInvoice(input);
      const replay = await adapter.issueInvoice(input);
      expect(first.ok).toBe(true);
      expect(replay.ok).toBe(true);
      if (first.ok && replay.ok)
        expect(replay.value.providerInvoiceId).toBe(
          first.value.providerInvoiceId,
        );
    });
  });
}
