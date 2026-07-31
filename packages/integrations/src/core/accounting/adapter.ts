import { createHash } from "node:crypto";

import type {
  AccountingPort,
  Currency,
  IdempotencyKey,
  Money,
  ProviderResult,
} from "@clockwork/contracts";
import { MoneySchema } from "@clockwork/contracts";

import { stableExternalId, toProviderFailure } from "../provider-result";

export type AccountingExportKind =
  | "accounts_receivable_invoice"
  | "auto_charge_payout"
  | "deferred_revenue_schedule"
  | "commission_bill"
  | "tax_liability"
  | "cost_summary"
  | "posting_request";

export interface AccountingJournalLine {
  readonly account: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly currency: Currency;
  readonly description: string;
  readonly dimensions?: Readonly<Record<string, string>>;
}

export interface AccountingExportRecord {
  readonly recordId: string;
  readonly kind: AccountingExportKind;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly effectiveOn: string;
  readonly currency?: Currency;
  readonly journalLines?: readonly AccountingJournalLine[];
  readonly scheduleLines?: readonly {
    readonly period: string;
    readonly earnedMinor: string;
    readonly deferredEndingMinor: string;
  }[];
  readonly attributes: Readonly<Record<string, string>>;
}

export interface AccountingExportBatch {
  readonly schemaVersion: 1;
  readonly batchId: string;
  readonly generatedAt: string;
  readonly records: readonly AccountingExportRecord[];
  readonly checksum: string;
}

export interface AccountingExportSink {
  write(input: {
    readonly batch: AccountingExportBatch;
    readonly idempotencyKey: string;
  }): Promise<ProviderResult<{ externalBatchId: string }>>;
}

export interface AccountingAccountMap {
  readonly accountsReceivable: string;
  readonly stripeClearing: string;
  readonly operatingBank: string;
  readonly processingFees: string;
  readonly deferredRevenue: string;
  readonly commissionExpense: string;
  readonly accountsPayable: string;
  readonly taxPayable: string;
  readonly costOfRevenue: string;
  readonly accruedCosts: string;
  readonly defaultRevenue: string;
}

export interface AccountingExportPort {
  exportAccountsReceivable(input: {
    readonly invoiceId: string;
    readonly accountId: string;
    readonly orderId: string;
    readonly issuedOn: string;
    readonly revenueAmount: Money;
    readonly taxAmount: Money;
    readonly revenueAccount?: string;
    readonly deferred: boolean;
    readonly idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ batchId: string; postingId: string }>>;
  exportPayoutSummary(input: {
    readonly payoutId: string;
    readonly effectiveOn: string;
    readonly grossCollected: Money;
    readonly fees: Money;
    readonly refunds: Money;
    readonly netPayout: Money;
    readonly idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ batchId: string }>>;
  exportDeferredRevenueSchedule(input: {
    readonly orderId: string;
    readonly startsOn: string;
    readonly monthlyEarned: readonly Money[];
    readonly idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ batchId: string }>>;
  exportCommissionBill(input: {
    readonly statementId: string;
    readonly partnerId: string;
    readonly statementOn: string;
    readonly amount: Money;
    readonly idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ batchId: string; billId: string }>>;
  exportTaxLiability(input: {
    readonly period: string;
    readonly jurisdiction: string;
    readonly amount: Money;
    readonly idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ batchId: string }>>;
  exportCostSummary(input: {
    readonly period: string;
    readonly region: string;
    readonly amount: Money;
    readonly idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ batchId: string }>>;
}

export interface ThreeWayTieOutLine {
  readonly currency: Currency;
  readonly platformMinor: string;
  readonly stripeMinor: string;
  readonly accountingMinor: string;
  readonly stripeVarianceMinor: string;
  readonly accountingVarianceMinor: string;
  readonly status: "tied" | "variance";
}

const defaultAccountMap: AccountingAccountMap = {
  accountsReceivable: "Accounts Receivable",
  stripeClearing: "Stripe Clearing",
  operatingBank: "Operating Bank",
  processingFees: "Payment Processing Fees",
  deferredRevenue: "Deferred Revenue",
  commissionExpense: "Partner Commissions",
  accountsPayable: "Accounts Payable",
  taxPayable: "Sales Tax Payable",
  costOfRevenue: "Cost of Revenue",
  accruedCosts: "Accrued Infrastructure Costs",
  defaultRevenue: "Commerce Revenue",
};

function add(...values: readonly string[]): string {
  return values.reduce((sum, value) => sum + BigInt(value), 0n).toString();
}

function subtract(left: string, right: string): string {
  return (BigInt(left) - BigInt(right)).toString();
}

function sameCurrency(...values: readonly Money[]): Currency {
  const currency = values[0]?.currency;
  if (!currency || values.some((value) => value.currency !== currency))
    throw new TypeError("Accounting inputs must have one currency");
  return currency;
}

function positive(value: Money, label: string): void {
  if (BigInt(value.minor) < 0n)
    throw new RangeError(`${label} cannot be negative`);
}

function line(
  account: string,
  currency: Currency,
  debit: string,
  credit: string,
  description: string,
  dimensions?: Readonly<Record<string, string>>,
): AccountingJournalLine {
  if (BigInt(debit) < 0n || BigInt(credit) < 0n)
    throw new RangeError(
      "Journal lines cannot contain negative debit or credit values",
    );
  if (BigInt(debit) > 0n && BigInt(credit) > 0n)
    throw new RangeError("A journal line cannot be both a debit and a credit");
  return {
    account,
    currency,
    debitMinor: debit,
    creditMinor: credit,
    description,
    ...(dimensions === undefined ? {} : { dimensions }),
  };
}

export function assertBalancedJournal(record: AccountingExportRecord): void {
  if (!record.journalLines) return;
  const currencies = new Set(record.journalLines.map((item) => item.currency));
  for (const currency of currencies) {
    const selected = record.journalLines.filter(
      (item) => item.currency === currency,
    );
    const debits = add(...selected.map((item) => item.debitMinor));
    const credits = add(...selected.map((item) => item.creditMinor));
    if (debits !== credits)
      throw new RangeError(
        `Unbalanced ${record.kind} journal in ${currency}: ${debits} debit, ${credits} credit`,
      );
  }
}

function makeBatch(
  records: readonly AccountingExportRecord[],
  generatedAt: string,
  idempotencyKey: string,
): AccountingExportBatch {
  for (const record of records) assertBalancedJournal(record);
  const batchId = stableExternalId("acct_batch", { idempotencyKey, records });
  const body = JSON.stringify({
    schemaVersion: 1,
    batchId,
    records,
  });
  return {
    schemaVersion: 1,
    batchId,
    generatedAt,
    records,
    checksum: createHash("sha256").update(body).digest("hex"),
  };
}

function monthSequence(startsOn: string, count: number): readonly string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startsOn);
  if (!match) throw new TypeError("Deferred revenue start must be YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (!Number.isInteger(year) || month < 0 || month > 11)
    throw new TypeError("Deferred revenue start date is invalid");
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month + index, 1));
    return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(
      date.getUTCMonth() + 1,
    ).padStart(2, "0")}`;
  });
}

export function threeWayTieOut(input: {
  readonly platform: readonly Money[];
  readonly stripe: readonly Money[];
  readonly accounting: readonly Money[];
}): readonly ThreeWayTieOutLine[] {
  const total = (values: readonly Money[], currency: Currency) =>
    add(
      ...values
        .filter((value) => value.currency === currency)
        .map((value) => value.minor),
    );
  return (["USD", "EUR", "GBP"] as const).map((currency) => {
    const platformMinor = total(input.platform, currency);
    const stripeMinor = total(input.stripe, currency);
    const accountingMinor = total(input.accounting, currency);
    const stripeVarianceMinor = subtract(stripeMinor, platformMinor);
    const accountingVarianceMinor = subtract(accountingMinor, platformMinor);
    return {
      currency,
      platformMinor,
      stripeMinor,
      accountingMinor,
      stripeVarianceMinor,
      accountingVarianceMinor,
      status:
        stripeVarianceMinor === "0" && accountingVarianceMinor === "0"
          ? "tied"
          : "variance",
    };
  });
}

/** Emits provider-neutral, balanced records; a selected QBO connector maps accounts. */
export class QboNeutralAccountingAdapter
  implements AccountingPort, AccountingExportPort
{
  private readonly accounts: AccountingAccountMap;

  public constructor(
    private readonly sink: AccountingExportSink,
    configuration: {
      readonly accounts?: Partial<AccountingAccountMap>;
      readonly now?: () => Date;
    } = {},
  ) {
    this.accounts = { ...defaultAccountMap, ...configuration.accounts };
    this.now = configuration.now ?? (() => new Date());
  }

  private readonly now: () => Date;

  private async write(
    records: readonly AccountingExportRecord[],
    idempotencyKey: string,
  ): Promise<ProviderResult<{ batchId: string; externalBatchId: string }>> {
    try {
      const batch = makeBatch(
        records,
        this.now().toISOString(),
        idempotencyKey,
      );
      const written = await this.sink.write({ batch, idempotencyKey });
      return written.ok
        ? {
            ok: true,
            value: {
              batchId: batch.batchId,
              externalBatchId: written.value.externalBatchId,
            },
          }
        : written;
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async postInvoice(
    input: Parameters<AccountingPort["postInvoice"]>[0],
  ): ReturnType<AccountingPort["postInvoice"]> {
    const record: AccountingExportRecord = {
      recordId: stableExternalId("acct_record", input),
      kind: "posting_request",
      sourceType: "invoice",
      sourceId: input.invoiceId,
      effectiveOn: this.now().toISOString().slice(0, 10),
      attributes: { posting_mode: input.mode },
    };
    const written = await this.write([record], input.idempotencyKey);
    return written.ok
      ? {
          ok: true,
          value: {
            postingId: stableExternalId("posting", written.value.batchId),
          },
        }
      : written;
  }

  public async postCommissionBill(
    input: Parameters<AccountingPort["postCommissionBill"]>[0],
  ): ReturnType<AccountingPort["postCommissionBill"]> {
    const result = await this.exportCommissionBill({
      statementId: input.statementId,
      partnerId: "unspecified",
      statementOn: this.now().toISOString().slice(0, 10),
      amount: input.amount,
      idempotencyKey: input.idempotencyKey,
    });
    return result.ok
      ? { ok: true, value: { billId: result.value.billId } }
      : result;
  }

  public async exportAccountsReceivable(
    input: Parameters<AccountingExportPort["exportAccountsReceivable"]>[0],
  ): ReturnType<AccountingExportPort["exportAccountsReceivable"]> {
    try {
      const currency = sameCurrency(input.revenueAmount, input.taxAmount);
      positive(input.revenueAmount, "Revenue");
      positive(input.taxAmount, "Tax");
      const total = add(input.revenueAmount.minor, input.taxAmount.minor);
      const dimensions = {
        account_id: input.accountId,
        order_id: input.orderId,
      };
      const record: AccountingExportRecord = {
        recordId: stableExternalId("acct_record", input),
        kind: "accounts_receivable_invoice",
        sourceType: "invoice",
        sourceId: input.invoiceId,
        effectiveOn: input.issuedOn,
        currency,
        journalLines: [
          line(
            this.accounts.accountsReceivable,
            currency,
            total,
            "0",
            `Invoice ${input.invoiceId}`,
            dimensions,
          ),
          line(
            input.deferred
              ? this.accounts.deferredRevenue
              : (input.revenueAccount ?? this.accounts.defaultRevenue),
            currency,
            "0",
            input.revenueAmount.minor,
            input.deferred
              ? "Deferred contract revenue"
              : "Earned contract revenue",
            dimensions,
          ),
          line(
            this.accounts.taxPayable,
            currency,
            "0",
            input.taxAmount.minor,
            "Stripe Tax liability",
            dimensions,
          ),
        ],
        attributes: {
          posting_mode: "accounts_receivable",
          deferred: String(input.deferred),
        },
      };
      const written = await this.write([record], input.idempotencyKey);
      return written.ok
        ? {
            ok: true,
            value: {
              batchId: written.value.batchId,
              postingId: stableExternalId("posting", record.recordId),
            },
          }
        : written;
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async exportPayoutSummary(
    input: Parameters<AccountingExportPort["exportPayoutSummary"]>[0],
  ): ReturnType<AccountingExportPort["exportPayoutSummary"]> {
    try {
      const currency = sameCurrency(
        input.grossCollected,
        input.fees,
        input.refunds,
        input.netPayout,
      );
      for (const [label, value] of [
        ["Gross collected", input.grossCollected],
        ["Fees", input.fees],
        ["Refunds", input.refunds],
        ["Net payout", input.netPayout],
      ] as const)
        positive(value, label);
      const expectedNet = subtract(
        subtract(input.grossCollected.minor, input.fees.minor),
        input.refunds.minor,
      );
      if (expectedNet !== input.netPayout.minor)
        throw new RangeError("Payout must equal gross less fees and refunds");
      const record: AccountingExportRecord = {
        recordId: stableExternalId("acct_record", input),
        kind: "auto_charge_payout",
        sourceType: "stripe_payout",
        sourceId: input.payoutId,
        effectiveOn: input.effectiveOn,
        currency,
        journalLines: [
          line(
            this.accounts.operatingBank,
            currency,
            input.netPayout.minor,
            "0",
            "Stripe net payout",
          ),
          line(
            this.accounts.processingFees,
            currency,
            input.fees.minor,
            "0",
            "Stripe processing fees",
          ),
          line(
            this.accounts.stripeClearing,
            currency,
            input.refunds.minor,
            "0",
            "Stripe refunds",
          ),
          line(
            this.accounts.stripeClearing,
            currency,
            "0",
            input.grossCollected.minor,
            "Stripe gross collections",
          ),
        ],
        attributes: { posting_mode: "payout_summary" },
      };
      const written = await this.write([record], input.idempotencyKey);
      return written.ok
        ? { ok: true, value: { batchId: written.value.batchId } }
        : written;
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async exportDeferredRevenueSchedule(
    input: Parameters<AccountingExportPort["exportDeferredRevenueSchedule"]>[0],
  ): ReturnType<AccountingExportPort["exportDeferredRevenueSchedule"]> {
    try {
      if (input.monthlyEarned.length === 0)
        throw new TypeError(
          "A deferred revenue schedule needs at least one month",
        );
      const currency = sameCurrency(...input.monthlyEarned);
      input.monthlyEarned.forEach((amount) =>
        positive(amount, "Monthly earned revenue"),
      );
      const total = add(...input.monthlyEarned.map((amount) => amount.minor));
      let earnedToDate = 0n;
      const periods = monthSequence(input.startsOn, input.monthlyEarned.length);
      const scheduleLines = input.monthlyEarned.map((amount, index) => {
        earnedToDate += BigInt(amount.minor);
        return {
          period: periods[index] ?? "",
          earnedMinor: amount.minor,
          deferredEndingMinor: (BigInt(total) - earnedToDate).toString(),
        };
      });
      const record: AccountingExportRecord = {
        recordId: stableExternalId("acct_record", input),
        kind: "deferred_revenue_schedule",
        sourceType: "order",
        sourceId: input.orderId,
        effectiveOn: input.startsOn,
        currency,
        scheduleLines,
        attributes: { total_deferred_minor: total },
      };
      const written = await this.write([record], input.idempotencyKey);
      return written.ok
        ? { ok: true, value: { batchId: written.value.batchId } }
        : written;
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async exportCommissionBill(
    input: Parameters<AccountingExportPort["exportCommissionBill"]>[0],
  ): ReturnType<AccountingExportPort["exportCommissionBill"]> {
    try {
      positive(input.amount, "Commission bill");
      const record: AccountingExportRecord = {
        recordId: stableExternalId("acct_record", input),
        kind: "commission_bill",
        sourceType: "commission_statement",
        sourceId: input.statementId,
        effectiveOn: input.statementOn,
        currency: input.amount.currency,
        journalLines: [
          line(
            this.accounts.commissionExpense,
            input.amount.currency,
            input.amount.minor,
            "0",
            "Partner commission expense",
            { partner_id: input.partnerId },
          ),
          line(
            this.accounts.accountsPayable,
            input.amount.currency,
            "0",
            input.amount.minor,
            "Partner commission payable",
            { partner_id: input.partnerId },
          ),
        ],
        attributes: { partner_id: input.partnerId },
      };
      const written = await this.write([record], input.idempotencyKey);
      return written.ok
        ? {
            ok: true,
            value: {
              batchId: written.value.batchId,
              billId: stableExternalId("bill", record.recordId),
            },
          }
        : written;
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async exportTaxLiability(
    input: Parameters<AccountingExportPort["exportTaxLiability"]>[0],
  ): ReturnType<AccountingExportPort["exportTaxLiability"]> {
    try {
      positive(input.amount, "Tax liability");
      const record: AccountingExportRecord = {
        recordId: stableExternalId("acct_record", input),
        kind: "tax_liability",
        sourceType: "tax_period",
        sourceId: `${input.jurisdiction}:${input.period}`,
        effectiveOn: `${input.period}-01`,
        currency: input.amount.currency,
        journalLines: [
          line(
            this.accounts.stripeClearing,
            input.amount.currency,
            input.amount.minor,
            "0",
            "Tax collected by Stripe",
          ),
          line(
            this.accounts.taxPayable,
            input.amount.currency,
            "0",
            input.amount.minor,
            `Tax liability for ${input.jurisdiction}`,
          ),
        ],
        attributes: { jurisdiction: input.jurisdiction, period: input.period },
      };
      const written = await this.write([record], input.idempotencyKey);
      return written.ok
        ? { ok: true, value: { batchId: written.value.batchId } }
        : written;
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async exportCostSummary(
    input: Parameters<AccountingExportPort["exportCostSummary"]>[0],
  ): ReturnType<AccountingExportPort["exportCostSummary"]> {
    try {
      positive(input.amount, "Cost summary");
      const record: AccountingExportRecord = {
        recordId: stableExternalId("acct_record", input),
        kind: "cost_summary",
        sourceType: "orchestrator_cost_period",
        sourceId: `${input.region}:${input.period}`,
        effectiveOn: `${input.period}-01`,
        currency: input.amount.currency,
        journalLines: [
          line(
            this.accounts.costOfRevenue,
            input.amount.currency,
            input.amount.minor,
            "0",
            `Infrastructure cost for ${input.region}`,
          ),
          line(
            this.accounts.accruedCosts,
            input.amount.currency,
            "0",
            input.amount.minor,
            "Accrued infrastructure cost",
          ),
        ],
        attributes: { region: input.region, period: input.period },
      };
      const written = await this.write([record], input.idempotencyKey);
      return written.ok
        ? { ok: true, value: { batchId: written.value.batchId } }
        : written;
    } catch (error) {
      return toProviderFailure(error);
    }
  }
}

export class InMemoryAccountingExportSink implements AccountingExportSink {
  private readonly byIdempotencyKey = new Map<
    string,
    { checksum: string; externalBatchId: string }
  >();
  public readonly batches: AccountingExportBatch[] = [];

  public write(input: {
    readonly batch: AccountingExportBatch;
    readonly idempotencyKey: string;
  }): Promise<ProviderResult<{ externalBatchId: string }>> {
    const existing = this.byIdempotencyKey.get(input.idempotencyKey);
    if (existing && existing.checksum !== input.batch.checksum)
      return Promise.resolve({
        ok: false,
        kind: "permanent",
        code: "ACCOUNTING_IDEMPOTENCY_CONFLICT",
        message:
          "The accounting idempotency key was reused with different content",
      });
    if (existing)
      return Promise.resolve({
        ok: true,
        value: { externalBatchId: existing.externalBatchId },
        duplicate: true,
      });
    const externalBatchId = stableExternalId(
      "accounting_export",
      input.batch.batchId,
    );
    this.byIdempotencyKey.set(input.idempotencyKey, {
      checksum: input.batch.checksum,
      externalBatchId,
    });
    this.batches.push(input.batch);
    return Promise.resolve({ ok: true, value: { externalBatchId } });
  }
}

export function accountingMoney(currency: Currency, minor: string): Money {
  return MoneySchema.parse({ currency, minor });
}
