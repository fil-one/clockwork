import {
  IdempotencyKeySchema,
  ids,
  type ProviderResult,
} from "@clockwork/contracts";
import {
  FakeProviderKernel,
  createFakeProviderPorts,
} from "@clockwork/integrations/fakes";
import { describe, expect, it, vi } from "vitest";

import { renderCsv } from "./csv";
import {
  downstreamIdempotencyKey,
  formatDecimal,
  parseDecimal,
} from "./determinism";
import {
  CoreFinanceWorkflowEngine,
  TransientWorkflowError,
  decideCertificateExpiry,
  decideDunning,
  decidePartnerCredit,
} from "./engine";
import {
  InMemoryCoreWorkflowRecordPort,
  InMemoryWorkflowExceptionPort,
  InMemoryWorkflowRunStore,
} from "./memory";
import { coreWorkflowTaskIds, type CoreWorkflowDependencies } from "./ports";
import {
  CertificateExpiryInputSchema,
  DunningInputSchema,
  ExportReportInputSchema,
  IssueInvoiceInputSchema,
  PartnerCreditInputSchema,
  ReconcileUsageInputSchema,
  SettleCommissionsInputSchema,
  SyncOverageInputSchema,
  ThreeWayReconciliationInputSchema,
  type ExportReportInput,
  type ReconcileUsageInput,
  type SettleCommissionsInput,
  type ThreeWayReconciliationInput,
} from "./schemas";

const ID = {
  account: ids.account.parse("10000000-0000-4000-8000-000000000001"),
  partner: ids.account.parse("10000000-0000-4000-8000-000000000002"),
  endClient: ids.account.parse("10000000-0000-4000-8000-000000000003"),
  order: ids.order.parse("20000000-0000-4000-8000-000000000001"),
  invoice: ids.invoice.parse("30000000-0000-4000-8000-000000000001"),
  ledger: ids.commitmentLedger.parse("40000000-0000-4000-8000-000000000001"),
  period: "40000000-0000-4000-8000-000000000004",
  ledgerEntry: ids.commitmentEntry.parse(
    "40000000-0000-4000-8000-000000000002",
  ),
  organization: ids.organization.parse("50000000-0000-4000-8000-000000000001"),
  statement: ids.document.parse("60000000-0000-4000-8000-000000000001"),
  accrual: ids.commissionAccrual.parse("70000000-0000-4000-8000-000000000001"),
  report: ids.reportExport.parse("80000000-0000-4000-8000-000000000001"),
};

const NOW = "2026-07-31T16:00:00.000Z";

function context(aggregateId: string, version = 1) {
  return {
    aggregateId,
    aggregateVersion: version,
    requestId: ids.request.parse("request-core-finance-0001"),
    occurredAt: NOW,
  };
}

function success<T>(value: T): ProviderResult<T> {
  return { ok: true, value };
}

function fixture(overrides?: {
  capabilities?: CoreWorkflowDependencies["capabilities"];
  commissionAccounting?: CoreWorkflowDependencies["commissionAccounting"];
  commissionSettlements?: CoreWorkflowDependencies["commissionSettlements"];
  usage?: CoreWorkflowDependencies["usage"];
  reporting?: CoreWorkflowDependencies["reporting"];
}) {
  const kernel = new FakeProviderKernel();
  const providers = createFakeProviderPorts(kernel);
  const runs = new InMemoryWorkflowRunStore();
  const exceptions = new InMemoryWorkflowExceptionPort();
  const records = new InMemoryCoreWorkflowRecordPort();
  const dependencies: CoreWorkflowDependencies = {
    capabilities: overrides?.capabilities ?? {
      require: () => Promise.resolve({ allowed: true, disabled: [] }),
    },
    runs,
    exceptions,
    records,
    billing: providers.billing,
    accounting: providers.accounting,
    commissionAccounting: overrides?.commissionAccounting ?? {
      postVerifiedCommissionBill: async (input) => {
        const posted = await providers.accounting.postCommissionBill({
          statementId: ids.document.parse(input.statementId),
          amount: input.amount,
          idempotencyKey: input.idempotencyKey,
        });
        return posted.ok
          ? {
              ok: true as const,
              value: { ...posted.value, vendorId: "vendor_verified" },
            }
          : posted;
      },
    },
    commissionSettlements: overrides?.commissionSettlements ?? {
      validate: () => Promise.resolve({}),
      finalize: () => Promise.resolve({}),
    },
    notifications: providers.notifications,
    usage: overrides?.usage ?? providers.usage,
    exports: providers.evidence,
    metering: {
      syncOverage: (input) =>
        Promise.resolve(
          success({
            providerInvoiceItemIds: input.lines.map(
              (_, index) => `ii_${index + 1}`,
            ),
            duplicateSourceUsageIds: [],
          }),
        ),
    },
    reporting:
      overrides?.reporting ??
      ({
        query: () =>
          Promise.resolve(success({ rows: [], sourceVersion: "db:1" })),
      } satisfies CoreWorkflowDependencies["reporting"]),
  };
  return {
    engine: new CoreFinanceWorkflowEngine(dependencies),
    dependencies,
    kernel,
    providers,
    runs,
    exceptions,
    records,
  };
}

describe("persisted workflow capability boundaries", () => {
  it("rejects a disabled command before any provider effect", async () => {
    const { engine, kernel, exceptions } = fixture({
      capabilities: {
        require: () =>
          Promise.resolve({ allowed: false, disabled: ["billing"] }),
      },
    });

    const result = await engine.issueInvoice(invoiceInput());

    expect(result).toMatchObject({
      status: "permanent_failure",
      code: "PERSISTED_CAPABILITY_DISABLED",
    });
    expect(kernel.calls).toHaveLength(0);
    expect(exceptions.cases[0]?.metadata).toMatchObject({
      disabledCapabilities: "billing",
      recovery: "false",
    });
  });
});

function invoiceInput() {
  return IssueInvoiceInputSchema.parse({
    context: context(ID.invoice),
    invoiceId: ID.invoice,
    orderId: ID.order,
    billingAccountId: ID.account,
    customerId: "cus_clockwork",
    commercialShape: "direct",
    collectionMethod: "net_terms",
    amount: { currency: "USD", minor: "12345" },
    poNumber: "PO-42",
    apEmail: "ap@buyer.test",
    vendorSetupComplete: true,
    groups: [],
  });
}

describe("core workflow deterministic primitives", () => {
  it("accepts explicit PAYG invoice sources and rejects mixed or missing financial sources", () => {
    const base = { ...invoiceInput(), orderId: undefined };
    const paygSource = {
      kind: "payg",
      enrollmentId: ID.account,
      effectKey: "payg:august:1",
      month: "2026-08",
      revision: 1,
    };
    expect(
      IssueInvoiceInputSchema.parse({ ...base, paygSource }),
    ).toMatchObject({ paygSource });
    expect(() => IssueInvoiceInputSchema.parse(base)).toThrow();
    expect(() =>
      IssueInvoiceInputSchema.parse({ ...invoiceInput(), paygSource }),
    ).toThrow();
    expect(() =>
      IssueInvoiceInputSchema.parse({
        ...base,
        paygSource,
        commercialShape: "referral",
      }),
    ).toThrow();
  });

  it("uses exact 18-place decimal arithmetic", () => {
    const total =
      parseDecimal("1.000000000000000001") +
      parseDecimal("0.999999999999999999") -
      parseDecimal("0.5");
    expect(formatDecimal(total)).toBe("1.5");
  });

  it("produces safe bounded downstream idempotency keys", () => {
    const base = IdempotencyKeySchema.parse(`workflow:${"a".repeat(64)}`);
    const key = downstreamIdempotencyKey(base, "Stripe Invoice Create");
    expect(key).toBe(`${base}:stripe-invoice-create`);
  });

  it("escapes spreadsheet formulas and follows stable requested column order", () => {
    const result = renderCsv(
      [{ amount: 12, account: '=HYPERLINK("bad")' }],
      ["account", "amount"],
    );
    expect(new TextDecoder().decode(result.bytes)).toContain(
      '"\'=HYPERLINK(""bad"")",12',
    );
  });

  it("publishes only permanently versioned lane-prefixed task IDs", () => {
    expect(new Set(coreWorkflowTaskIds).size).toBe(coreWorkflowTaskIds.length);
    for (const taskId of coreWorkflowTaskIds)
      expect(taskId).toMatch(/^core\.[a-z-]+\.[a-z-]+\.v\d+$/);
  });
});

describe("billing workflows", () => {
  it("issues terms invoices, posts AR at issuance, and returns cached success on duplicate delivery", async () => {
    const { engine, kernel, records } = fixture();
    const first = await engine.issueInvoice(invoiceInput());
    const duplicate = await engine.issueInvoice({
      ...invoiceInput(),
      context: {
        ...invoiceInput().context,
        requestId: ids.request.parse("request-core-finance-duplicate"),
      },
    });

    expect(first).toMatchObject({ status: "completed", duplicate: false });
    expect(duplicate).toMatchObject({ status: "completed", duplicate: true });
    expect(kernel.calls.map(({ operation }) => operation)).toEqual([
      "billing.issueInvoice",
      "accounting.postInvoice",
    ]);
    expect(records.records).toHaveLength(1);
  });

  it("retries transient provider outcomes with the same downstream idempotency key", async () => {
    const { engine, kernel, runs } = fixture();
    kernel.enqueue("billing.issueInvoice", {
      outcome: "transient_failure",
      code: "RATE_LIMITED",
      delayMs: 250,
    });
    const input = invoiceInput();
    await expect(engine.issueInvoice(input)).rejects.toMatchObject({
      name: "TransientWorkflowError",
      code: "RATE_LIMITED",
      retryAfterMs: 250,
    });
    const completed = await engine.issueInvoice(input);
    expect(completed.status).toBe("completed");
    const calls = kernel.calls.filter(
      ({ operation }) => operation === "billing.issueInvoice",
    );
    expect(calls).toHaveLength(2);
    expect(
      calls.map(
        ({ input: callInput }) =>
          (callInput as { idempotencyKey: string }).idempotencyKey,
      ),
    ).toEqual([
      (calls[0]?.input as { idempotencyKey: string }).idempotencyKey,
      (calls[0]?.input as { idempotencyKey: string }).idempotencyKey,
    ]);
    const invocation = completed.invocationKey;
    expect(runs.inspect(IdempotencyKeySchema.parse(invocation))).toMatchObject({
      status: "completed",
      attempt: 2,
    });
  });

  it("routes permanent provider outcomes and only re-executes after an explicit replay", async () => {
    const { engine, kernel, exceptions } = fixture();
    kernel.enqueue("billing.issueInvoice", {
      outcome: "permanent_failure",
      code: "CUSTOMER_ARCHIVED",
      message: "sensitive provider detail must not escape",
    });
    const input = invoiceInput();
    const failed = await engine.issueInvoice(input);
    const cached = await engine.issueInvoice(input);
    const replayed = await engine.issueInvoice({
      ...input,
      context: {
        ...input.context,
        replay: {
          requestedBy: "finance-operator@test.invalid",
          reason: "Customer record was repaired in the billing sandbox",
          ticketReference: "FIN-42",
        },
      },
    });

    expect(failed).toMatchObject({
      status: "permanent_failure",
      duplicate: false,
      code: "CUSTOMER_ARCHIVED",
    });
    expect(JSON.stringify(failed)).not.toContain("sensitive provider detail");
    expect(cached).toMatchObject({
      status: "permanent_failure",
      duplicate: true,
    });
    expect(replayed).toMatchObject({ status: "completed", duplicate: false });
    expect(exceptions.cases).toHaveLength(1);
    expect(
      kernel.calls.filter(
        ({ operation }) => operation === "billing.issueInvoice",
      ),
    ).toHaveLength(2);
  });

  it("rejects invalid net-terms prerequisites and partner grouping", () => {
    const base = invoiceInput();
    expect(() =>
      IssueInvoiceInputSchema.parse({
        ...base,
        poNumber: undefined,
      }),
    ).toThrow(/PO, AP contact/);
    expect(() =>
      IssueInvoiceInputSchema.parse({
        ...base,
        commercialShape: "resale",
      }),
    ).toThrow(/end-client line grouping/);
  });

  it("requires ledger-authorized, tax-coded overage lines with unique source usage", () => {
    const line = {
      ledgerEntryId: ID.ledgerEntry,
      sku: "storage",
      taxCode: "txcd_10103001",
      quantity: "1",
      contractedUnitRate: { currency: "USD", minor: "100" },
      amount: { currency: "USD", minor: "100" },
      sourceUsageIds: ["usage-1"],
    };
    expect(() =>
      SyncOverageInputSchema.parse({
        context: context(ID.period),
        periodId: ID.period,
        ledgerId: ID.ledger,
        orderId: ID.order,
        invoiceId: ID.invoice,
        providerInvoiceId: "in_clockwork",
        customerId: "cus_clockwork",
        periodStart: "2026-07-01T00:00:00.000Z",
        periodEnd: "2026-08-01T00:00:00.000Z",
        lines: [
          line,
          {
            ...line,
            ledgerEntryId: ids.commitmentEntry.parse(
              "40000000-0000-4000-8000-000000000003",
            ),
          },
        ],
      }),
    ).toThrow(/source usage event can authorize only one overage line/);
  });
});

describe("collections policy", () => {
  const dunning = DunningInputSchema.parse({
    context: context(ID.invoice),
    invoiceId: ID.invoice,
    billingAccountId: ID.partner,
    commercialShape: "resale",
    invoiceStatus: "past_due",
    daysPastDue: 61,
    firstThresholdDays: 15,
    secondThresholdDays: 45,
    outstanding: { currency: "USD", minor: "45000" },
    maxRetentionUntil: "2027-08-01T00:00:00.000Z",
    retentionLiabilityRule: "customer_pays_through_retention",
    serviceRunning: true,
    collectionsOwner: "collections@clockwork.test",
    billingRecipients: ["ap@partner.test"],
  });

  it("never permits deletion and requires human review before write suspension", () => {
    expect(decideDunning(dunning)).toEqual({
      stage: "second_threshold",
      pauseNewCommerce: true,
      writeSuspensionRequiresReview: true,
      deletionPermitted: false,
      retentionBlockedUntil: "2027-08-01T00:00:00.000Z",
    });
  });

  it("records a collections exception and notifies only supplied billing-party recipients", async () => {
    const { engine, exceptions, kernel, records } = fixture();
    const outcome = await engine.applyDunning(dunning);
    expect(outcome).toMatchObject({
      status: "completed",
      value: {
        decision: {
          stage: "second_threshold",
          deletionPermitted: false,
        },
      },
    });
    expect(exceptions.cases[0]).toMatchObject({
      queue: "credit_collections",
      code: "DUNNING_SECOND_THRESHOLD",
    });
    const notification = kernel.calls.find(
      ({ operation }) => operation === "notifications.send",
    )?.input as {
      recipients: string[];
      data: { outstanding?: { currency: string; minor: string } };
    };
    expect(notification.recipients).toEqual([
      "collections@clockwork.test",
      "ap@partner.test",
    ]);
    expect(notification.data.outstanding).toEqual({
      currency: "USD",
      minor: "45000",
    });
    expect(records.records[0]?.record.kind).toBe("dunning_decided");
  });

  it("stops chasing an invoice that carries no remainder", async () => {
    const settled = DunningInputSchema.parse({
      ...dunning,
      outstanding: { currency: "USD", minor: "0" },
    });
    expect(decideDunning(settled)).toEqual({
      stage: "current",
      pauseNewCommerce: false,
      writeSuspensionRequiresReview: false,
      deletionPermitted: false,
      retentionBlockedUntil: "2027-08-01T00:00:00.000Z",
    });
    const { engine, exceptions, kernel } = fixture();
    await engine.applyDunning(settled);
    expect(exceptions.cases).toEqual([]);
    expect(
      kernel.calls.find(({ operation }) => operation === "notifications.send"),
    ).toBeUndefined();
  });

  it("decides an unchanged stage for a payload queued without a remainder", () => {
    const legacy = Object.fromEntries(
      Object.entries(dunning).filter(([key]) => key !== "outstanding"),
    );
    expect(decideDunning(DunningInputSchema.parse(legacy))).toEqual(
      decideDunning(dunning),
    );
  });

  it("blocks only requested new service when partner exposure exceeds policy", async () => {
    const newService = PartnerCreditInputSchema.parse({
      context: context(ID.order),
      partnerAccountId: ID.partner,
      orderId: ID.order,
      serviceKind: "new_end_client",
      creditPolicy: "net_terms",
      currency: "USD",
      currentExposureMinor: "9000",
      requestedExposureMinor: "2000",
      creditLimitMinor: "10000",
      hasRequiredPaymentHistory: true,
      collectionsOwner: "collections@clockwork.test",
    });
    expect(decidePartnerCredit(newService)).toMatchObject({
      allowNewService: false,
      reason: "aggregate_credit_limit_exceeded",
    });
    expect(
      decidePartnerCredit({ ...newService, serviceKind: "running_service" }),
    ).toMatchObject({
      allowNewService: true,
      reason: "running_service_never_blocked",
    });

    const { engine, exceptions } = fixture();
    const result = await engine.evaluatePartnerCredit(newService);
    expect(result).toMatchObject({
      status: "completed",
      value: { decision: { allowNewService: false } },
    });
    expect(exceptions.cases[0]?.safeDetail).toContain(
      "already-running end-client services remain active",
    );
  });
});

describe("commission and reconciliation workflows", () => {
  it("nets positive accruals, clawbacks, and holdbacks into one payable bill", async () => {
    const { engine, kernel } = fixture();
    const input: SettleCommissionsInput = SettleCommissionsInputSchema.parse({
      context: context(ID.statement),
      statementId: ID.statement,
      partnerAccountId: ID.partner,
      periodStart: "2026-04-01",
      periodEnd: "2026-06-30",
      currency: "USD",
      accruals: [
        {
          accrualId: ID.accrual,
          invoiceId: ID.invoice,
          currency: "USD",
          collectedRevenueMinor: "100000",
          commissionMinor: "10000",
          holdbackMinor: "2000",
          status: "stated",
        },
        {
          accrualId: ids.commissionAccrual.parse(
            "70000000-0000-4000-8000-000000000002",
          ),
          invoiceId: ID.invoice,
          currency: "USD",
          collectedRevenueMinor: "-10000",
          commissionMinor: "-1000",
          holdbackMinor: "-200",
          status: "stated",
        },
      ],
    });
    const result = await engine.settleCommissions(input);
    expect(result).toMatchObject({
      status: "completed",
      value: { payableMinor: "7200", heldMinor: "1800" },
    });
    const posting = kernel.calls.find(
      ({ operation }) => operation === "accounting.postCommissionBill",
    )?.input as { amount: { minor: string } };
    expect(posting.amount.minor).toBe("7200");
  });

  it("rejects a forged settlement binding before any accounting effect", async () => {
    const postVerifiedCommissionBill = vi.fn();
    const { engine } = fixture({
      commissionAccounting: { postVerifiedCommissionBill },
      commissionSettlements: {
        validate: () =>
          Promise.reject(new Error("cross-partner statement binding")),
        finalize: vi.fn(),
      },
    });
    const result = await engine.settleCommissions(
      SettleCommissionsInputSchema.parse({
        context: context(ID.statement),
        statementId: ID.statement,
        partnerAccountId: ID.partner,
        periodStart: "2026-04-01",
        periodEnd: "2026-06-30",
        currency: "USD",
        accruals: [
          {
            accrualId: ID.accrual,
            invoiceId: ID.invoice,
            currency: "USD",
            collectedRevenueMinor: "100000",
            commissionMinor: "10000",
            holdbackMinor: "2000",
            status: "stated",
          },
        ],
      }),
    );
    expect(result).toMatchObject({
      status: "permanent_failure",
      code: "COMMISSION_SETTLEMENT_BINDING_INVALID",
    });
    expect(postVerifiedCommissionBill).not.toHaveBeenCalled();
  });

  it("replays one provider bill after a crash and then finalizes the exact persisted lines", async () => {
    const providerKeys: string[] = [];
    const finalized: Parameters<
      CoreWorkflowDependencies["commissionSettlements"]["finalize"]
    >[0][] = [];
    let commitAttempt = 0;
    const { engine } = fixture({
      commissionAccounting: {
        postVerifiedCommissionBill: (input) => {
          providerKeys.push(input.idempotencyKey);
          return Promise.resolve(
            success({ billId: "bill_replay_safe", vendorId: "vendor_bound" }),
          );
        },
      },
      commissionSettlements: {
        validate: () => Promise.resolve({}),
        finalize: (input) => {
          finalized.push(input);
          commitAttempt += 1;
          return commitAttempt === 1
            ? Promise.reject(new Error("crash after provider success"))
            : Promise.resolve({ duplicate: false });
        },
      },
    });
    const input = SettleCommissionsInputSchema.parse({
      context: context(ID.statement),
      statementId: ID.statement,
      partnerAccountId: ID.partner,
      periodStart: "2026-04-01",
      periodEnd: "2026-06-30",
      currency: "USD",
      accruals: [
        {
          accrualId: ID.accrual,
          invoiceId: ID.invoice,
          currency: "USD",
          collectedRevenueMinor: "100000",
          commissionMinor: "10000",
          holdbackMinor: "2000",
          status: "stated",
        },
      ],
    });

    await expect(engine.settleCommissions(input)).rejects.toMatchObject({
      code: "COMMISSION_SETTLEMENT_COMMIT_UNAVAILABLE",
    });
    await expect(engine.settleCommissions(input)).resolves.toMatchObject({
      status: "completed",
      value: { billId: "bill_replay_safe", payableMinor: "8000" },
    });
    expect(providerKeys).toHaveLength(2);
    expect(new Set(providerKeys).size).toBe(1);
    expect(finalized).toHaveLength(2);
    expect(finalized[1]).toMatchObject({
      statementId: ID.statement,
      partnerAccountId: ID.partner,
      expectedRowVersion: 1,
      accrualIds: [ID.accrual],
      providerBillId: "bill_replay_safe",
    });
  });

  it("deduplicates usage, excludes out-of-range events, and routes source variances", async () => {
    const usage: CoreWorkflowDependencies["usage"] = {
      pullUsage: () =>
        Promise.resolve(
          success([
            {
              externalId: "usage-1",
              sku: "storage",
              quantity: "1.25",
              measuredAt: "2026-07-15T00:00:00.000Z",
            },
            {
              externalId: "usage-1",
              sku: "storage",
              quantity: "1.25",
              measuredAt: "2026-07-15T00:00:00.000Z",
            },
            {
              externalId: "usage-outside",
              sku: "storage",
              quantity: "99",
              measuredAt: "2026-08-01T00:00:00.000Z",
            },
          ]),
        ),
    };
    const { engine, exceptions } = fixture({ usage });
    const input: ReconcileUsageInput = ReconcileUsageInputSchema.parse({
      context: context(ID.ledger),
      ledgerId: ID.ledger,
      organizationId: ID.organization,
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
      expected: [
        {
          sku: "storage",
          quantity: "1.5",
          sourceUsageIds: ["usage-1", "usage-missing"],
        },
      ],
    });
    const result = await engine.reconcileUsage(input);
    expect(result).toMatchObject({
      status: "completed",
      value: {
        variances: [
          {
            sku: "storage",
            expected: "1.5",
            actual: "1.25",
            difference: "-0.25",
          },
        ],
        missingSourceUsageIds: ["usage-missing"],
        unexpectedSourceUsageIds: ["usage-outside"],
      },
    });
    expect(exceptions.cases[0]?.code).toBe("USAGE_RECONCILIATION_VARIANCE");
  });

  it("opens an owned exception for any currency that fails the three-way tie-out", async () => {
    const { engine, exceptions } = fixture();
    const input: ThreeWayReconciliationInput =
      ThreeWayReconciliationInputSchema.parse({
        context: context(ID.report),
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        platform: [{ currency: "USD", minor: "10000" }],
        billingProvider: [{ currency: "USD", minor: "9999" }],
        accounting: [{ currency: "USD", minor: "10000" }],
        toleranceMinor: "0",
      });
    const result = await engine.reconcileThreeWay(input);
    expect(result).toMatchObject({
      status: "completed",
      value: {
        variances: [
          {
            currency: "USD",
            platformMinor: "10000",
            billingProviderMinor: "9999",
            accountingMinor: "10000",
          },
        ],
      },
    });
    expect(exceptions.cases[0]).toMatchObject({
      code: "THREE_WAY_TIE_OUT_VARIANCE",
      queue: "reconciliation",
      severity: "blocking",
    });
  });
});

describe("reporting workflows", () => {
  it("labels margin as modeled until cost ingestion is complete and stores an immutable CSV", async () => {
    const reporting: CoreWorkflowDependencies["reporting"] = {
      query: () =>
        Promise.resolve(
          success({
            rows: [{ order_id: ID.order, margin_minor: "4200", note: "=1+1" }],
            sourceVersion: "txid:9001",
          }),
        ),
    };
    const { engine, providers, records } = fixture({ reporting });
    const input: ExportReportInput = ExportReportInputSchema.parse({
      context: context(ID.report),
      reportExportId: ID.report,
      reportType: "margin_poc_cost",
      asOf: NOW,
      from: "2026-07-01",
      to: "2026-07-31",
      requestedColumns: ["order_id", "note"],
      costIngestionComplete: false,
      retainUntil: "2033-07-31T16:00:00.000Z",
    });
    const result = await engine.exportReport(input);
    expect(result).toMatchObject({
      status: "completed",
      value: {
        rowCount: 1,
        sourceVersion: "txid:9001",
        marginLabel: "modeled",
      },
    });
    if (result.status !== "completed")
      throw new Error("expected completed export");
    const stored = await providers.evidence.get(
      ids.document.parse(result.value.documentId),
    );
    expect(stored.ok).toBe(true);
    if (stored.ok) {
      const text = new TextDecoder().decode(stored.value.bytes);
      expect(text).toContain("margin_basis");
      expect(text).toContain("modeled");
      expect(text).toContain("'=1+1");
    }
    expect(records.records[0]?.record).toMatchObject({
      kind: "report_exported",
      marginLabel: "modeled",
    });
  });
});

describe("operator-safe transient errors", () => {
  it("does not include malformed payload values in validation errors", async () => {
    const { engine } = fixture();
    await expect(
      engine.issueInvoice({ apiKey: "must-not-appear-in-error" }),
    ).rejects.toMatchObject({
      name: "WorkflowPayloadError",
      code: "INVALID_WORKFLOW_PAYLOAD",
      message:
        "The workflow payload is invalid and must be corrected before replay",
    });
  });

  it("does not surface arbitrary dependency exception messages", async () => {
    const fixtureValue = fixture({
      reporting: {
        query: () =>
          Promise.reject(new Error("secret database host and password")),
      },
    });
    const input = ExportReportInputSchema.parse({
      context: context(ID.report),
      reportExportId: ID.report,
      reportType: "weekly_scorecard",
      asOf: NOW,
      retainUntil: "2033-07-31T16:00:00.000Z",
    });
    let caught: unknown;
    try {
      await fixtureValue.engine.exportReport(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TransientWorkflowError);
    expect(String(caught)).not.toContain("secret database host");
  });
});

describe("exemption certificate expiry sweep", () => {
  const profile = "10000000-0000-4000-8000-0000000000a1";

  function certificates(
    entries: readonly { jurisdiction: string; expiresOn: string | null }[],
  ) {
    return CertificateExpiryInputSchema.parse({
      context: context(ID.account),
      accountId: ID.account,
      procurementProfileId: profile,
      asOfDate: "2026-07-31",
      noticeWindowDays: 30,
      certificates: entries.map((entry, index) => ({
        certificateId: `90000000-0000-4000-8000-00000000000${index + 1}`,
        jurisdiction: entry.jurisdiction,
        documentId: `a0000000-0000-4000-8000-00000000000${index + 1}`,
        expiresOn: entry.expiresOn,
      })),
      procurementOwner: "collections@clockwork.test",
      billingRecipients: ["ap@customer.test"],
    });
  }

  it("leaves certificates outside the notice window alone", () => {
    expect(
      decideCertificateExpiry(
        certificates([{ jurisdiction: "US-CA", expiresOn: "2027-01-01" }]),
      ),
    ).toEqual({
      stage: "clear",
      expiringCount: 0,
      expiredCount: 0,
      blocksInvoicing: false,
      tasks: [],
    });
  });

  it("raises a follow-up due on the expiry date inside the notice window", () => {
    expect(
      decideCertificateExpiry(
        certificates([{ jurisdiction: "US-CA", expiresOn: "2026-08-10" }]),
      ),
    ).toEqual({
      stage: "notice",
      expiringCount: 1,
      expiredCount: 0,
      blocksInvoicing: false,
      tasks: [
        {
          kind: "collect_exemption_certificate",
          jurisdiction: "US-CA",
          documentId: "a0000000-0000-4000-8000-000000000001",
          dueAt: "2026-08-10",
        },
      ],
    });
  });

  it("flags a lapsed certificate without blocking invoicing", () => {
    const decision = decideCertificateExpiry(
      certificates([
        { jurisdiction: "US-CA", expiresOn: "2026-01-01" },
        { jurisdiction: "GB", expiresOn: null },
      ]),
    );

    expect(decision).toMatchObject({
      stage: "lapsed",
      expiredCount: 1,
      expiringCount: 0,
      // EXT-TAX-01 owns the block policy; the sweep only flags.
      blocksInvoicing: false,
    });
    expect(decision.tasks).toEqual([
      {
        kind: "collect_exemption_certificate",
        jurisdiction: "US-CA",
        documentId: "a0000000-0000-4000-8000-000000000001",
        dueAt: "2026-07-31",
      },
    ]);
  });

  it("reports a lapse ahead of a notice on the same account", () => {
    expect(
      decideCertificateExpiry(
        certificates([
          { jurisdiction: "US-NY", expiresOn: "2026-08-10" },
          { jurisdiction: "ES", expiresOn: "2025-12-01" },
        ]),
      ),
    ).toMatchObject({
      stage: "lapsed",
      expiredCount: 1,
      expiringCount: 1,
    });
  });

  it("opens a billing exception naming the follow-up task and records it", async () => {
    const { engine, exceptions, records } = fixture();
    const outcome = await engine.assessCertificateExpiry(
      certificates([{ jurisdiction: "US-CA", expiresOn: "2026-01-01" }]),
    );

    expect(outcome).toMatchObject({
      status: "completed",
      value: { decision: { stage: "lapsed", blocksInvoicing: false } },
    });
    expect(exceptions.cases[0]).toMatchObject({
      queue: "billing_operations",
      code: "EXEMPTION_CERTIFICATE_EXPIRED",
      severity: "warning",
    });
    expect(exceptions.cases[0]?.metadata).toMatchObject({
      followUpTaskKind: "collect_exemption_certificate",
      expiredCount: "1",
      jurisdictions: "US-CA",
    });
    expect(records.records[0]?.record).toMatchObject({
      kind: "certificate_expiry_assessed",
      taskId: "core.procurement.certificate-expiry.v1",
    });
  });

  it("opens no exception when every certificate is current", async () => {
    const { engine, exceptions, records } = fixture();
    const outcome = await engine.assessCertificateExpiry(
      certificates([{ jurisdiction: "US-CA", expiresOn: "2027-01-01" }]),
    );

    expect(outcome).toMatchObject({
      status: "completed",
      value: { decision: { stage: "clear" } },
    });
    expect(exceptions.cases).toEqual([]);
    expect(records.records).toHaveLength(1);
  });

  it("returns the first decision when the same sweep is delivered twice", async () => {
    const { engine, exceptions } = fixture();
    const input = certificates([
      { jurisdiction: "US-CA", expiresOn: "2026-01-01" },
    ]);

    const first = await engine.assessCertificateExpiry(input);
    const second = await engine.assessCertificateExpiry(input);

    expect(first).toMatchObject({ status: "completed", duplicate: false });
    expect(second).toMatchObject({ status: "completed", duplicate: true });
    expect(exceptions.cases).toHaveLength(1);
  });

  it("rejects a payload whose aggregate is not the account", async () => {
    const { engine } = fixture();
    await expect(
      engine.assessCertificateExpiry({
        ...certificates([{ jurisdiction: "US-CA", expiresOn: "2026-01-01" }]),
        context: context(ID.invoice),
      }),
    ).rejects.toThrow("must be the account identifier");
  });
});
