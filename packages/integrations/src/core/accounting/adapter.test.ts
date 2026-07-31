import { IdempotencyKeySchema, MoneySchema } from "@clockwork/contracts";
import { describe, expect, it } from "vitest";

import {
  assertBalancedJournal,
  InMemoryAccountingExportSink,
  QboNeutralAccountingAdapter,
  threeWayTieOut,
} from "./adapter";

const key = IdempotencyKeySchema.parse("accounting:invoice:1:v1");
const now = () => new Date("2026-07-31T16:00:00.000Z");

const money = (minor: string, currency: "USD" | "EUR" | "GBP" = "USD") =>
  MoneySchema.parse({ currency, minor });

describe("QBO-neutral accounting exports", () => {
  it("posts terms invoices to AR at issuance with deferred revenue and tax liability", async () => {
    const sink = new InMemoryAccountingExportSink();
    const adapter = new QboNeutralAccountingAdapter(sink, { now });
    const result = await adapter.exportAccountsReceivable({
      invoiceId: "invoice_1",
      accountId: "account_1",
      orderId: "order_1",
      issuedOn: "2026-07-31",
      revenueAmount: money("10000"),
      taxAmount: money("825"),
      deferred: true,
      idempotencyKey: key,
    });
    expect(result).toMatchObject({ ok: true });
    const record = sink.batches[0]?.records[0];
    expect(record?.kind).toBe("accounts_receivable_invoice");
    expect(record?.journalLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          account: "Accounts Receivable",
          debitMinor: "10825",
        }),
        expect.objectContaining({
          account: "Deferred Revenue",
          creditMinor: "10000",
        }),
        expect.objectContaining({
          account: "Sales Tax Payable",
          creditMinor: "825",
        }),
      ]),
    );
    if (!record) throw new Error("missing accounting record");
    expect(() => assertBalancedJournal(record)).not.toThrow();
  });

  it("emits a deterministic monthly deferred-revenue schedule", async () => {
    const sink = new InMemoryAccountingExportSink();
    const adapter = new QboNeutralAccountingAdapter(sink, { now });
    await adapter.exportDeferredRevenueSchedule({
      orderId: "order_annual",
      startsOn: "2026-08-15",
      monthlyEarned: [money("1000"), money("1000"), money("1001")],
      idempotencyKey: key,
    });
    expect(sink.batches[0]?.records[0]?.scheduleLines).toEqual([
      { period: "2026-08", earnedMinor: "1000", deferredEndingMinor: "2001" },
      { period: "2026-09", earnedMinor: "1000", deferredEndingMinor: "1001" },
      { period: "2026-10", earnedMinor: "1001", deferredEndingMinor: "0" },
    ]);
  });

  it("rejects a payout summary that does not tie gross to fees, refunds, and cash", async () => {
    const adapter = new QboNeutralAccountingAdapter(
      new InMemoryAccountingExportSink(),
      { now },
    );
    const result = await adapter.exportPayoutSummary({
      payoutId: "po_1",
      effectiveOn: "2026-07-31",
      grossCollected: money("10000"),
      fees: money("300"),
      refunds: money("500"),
      netPayout: money("9300"),
      idempotencyKey: key,
    });
    expect(result).toMatchObject({
      ok: false,
      kind: "permanent",
      code: "PROVIDER_ERROR",
    });
  });

  it("lists exact Stripe and accounting variances by currency", () => {
    expect(
      threeWayTieOut({
        platform: [money("100", "USD"), money("200", "EUR")],
        stripe: [money("100", "USD"), money("205", "EUR")],
        accounting: [money("100", "USD"), money("200", "EUR")],
      }),
    ).toEqual([
      expect.objectContaining({ currency: "USD", status: "tied" }),
      expect.objectContaining({
        currency: "EUR",
        status: "variance",
        stripeVarianceMinor: "5",
      }),
      expect.objectContaining({ currency: "GBP", status: "tied" }),
    ]);
  });
});
