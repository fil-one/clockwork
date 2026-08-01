import { IdempotencyKeySchema, MoneySchema, ids } from "@clockwork/contracts";
import { describe, expect, it, vi } from "vitest";

import { stableExternalId } from "../provider-result";
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

  it("fails closed when the legacy commission call omits partner and line bindings", async () => {
    const sink = new InMemoryAccountingExportSink();
    const adapter = new QboNeutralAccountingAdapter(sink, { now });
    await expect(
      adapter.postCommissionBill({
        statementId: ids.document.parse("40000000-0000-4000-8000-000000000001"),
        amount: money("7200"),
        idempotencyKey: key,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "COMMISSION_PARTNER_BINDING_REQUIRED",
    });
    expect(sink.batches).toHaveLength(0);
  });

  it("carries the persisted partner through a verified QBO vendor mapping and exact line binding", async () => {
    const sink = new InMemoryAccountingExportSink();
    const partnerAccountId = "80000000-0000-4000-8000-000000000001";
    const statementId = "40000000-0000-4000-8000-000000000001";
    const accrualIds = [
      "90000000-0000-4000-8000-000000000002",
      "90000000-0000-4000-8000-000000000001",
    ];
    const amount = money("7200");
    const lineBindingHash = stableExternalId("commission_lines", {
      statementId,
      partnerAccountId,
      currency: amount.currency,
      amountMinor: amount.minor,
      accrualIds: [...accrualIds].sort(),
    });
    const resolve = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        provider: "qbo",
        partnerAccountId,
        vendorId: "qbo_vendor_42",
        mappingVersion: 3,
        verifiedAt: "2026-07-31T15:00:00.000Z",
        status: "verified",
      },
    });
    const adapter = new QboNeutralAccountingAdapter(sink, {
      now,
      vendorMappings: { resolve },
    });
    const input = {
      statementId,
      partnerAccountId,
      statementOn: "2026-07-31",
      accrualIds,
      lineBindingHash,
      amount,
      idempotencyKey: key,
    } as const;
    const first = await adapter.postVerifiedCommissionBill(input);
    const replay = await adapter.postVerifiedCommissionBill(input);

    expect(first).toMatchObject({
      ok: true,
      value: { vendorId: "qbo_vendor_42" },
    });
    expect(replay).toMatchObject({ ok: true, duplicate: true });
    expect(sink.batches).toHaveLength(1);
    expect(sink.batches[0]?.records[0]).toMatchObject({
      sourceId: statementId,
      attributes: {
        partner_id: partnerAccountId,
        qbo_vendor_id: "qbo_vendor_42",
        vendor_mapping_version: "3",
        accrual_ids: [...accrualIds].sort().join(","),
        line_binding_hash: lineBindingHash,
      },
    });
  });

  it("rejects a cross-partner vendor mapping and a forged line digest before export", async () => {
    const sink = new InMemoryAccountingExportSink();
    const partnerAccountId = "80000000-0000-4000-8000-000000000001";
    const adapter = new QboNeutralAccountingAdapter(sink, {
      now,
      vendorMappings: {
        resolve: () =>
          Promise.resolve({
            ok: true,
            value: {
              provider: "qbo",
              partnerAccountId: "80000000-0000-4000-8000-000000000099",
              vendorId: "qbo_vendor_wrong_partner",
              mappingVersion: 1,
              verifiedAt: "2026-07-31T15:00:00.000Z",
              status: "verified",
            },
          }),
      },
    });
    const base = {
      statementId: "40000000-0000-4000-8000-000000000001",
      partnerAccountId,
      statementOn: "2026-07-31",
      accrualIds: ["90000000-0000-4000-8000-000000000001"],
      amount: money("7200"),
      idempotencyKey: key,
    } as const;
    await expect(
      adapter.postVerifiedCommissionBill({
        ...base,
        lineBindingHash: "forged",
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "COMMISSION_LINE_BINDING_MISMATCH",
    });
    const validHash = stableExternalId("commission_lines", {
      statementId: base.statementId,
      partnerAccountId,
      currency: base.amount.currency,
      amountMinor: base.amount.minor,
      accrualIds: base.accrualIds,
    });
    await expect(
      adapter.postVerifiedCommissionBill({
        ...base,
        lineBindingHash: validHash,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "QBO_VENDOR_MAPPING_INVALID",
    });
    expect(sink.batches).toHaveLength(0);
  });
});
