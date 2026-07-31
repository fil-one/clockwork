import { ids, type ProviderResult } from "@clockwork/contracts";
import {
  FakeProviderKernel,
  createFakeProviderPorts,
} from "@clockwork/integrations/fakes";
import { describe, expect, it } from "vitest";

import { CoreFinanceWorkflowEngine } from "./engine";
import {
  InMemoryCoreWorkflowRecordPort,
  InMemoryWorkflowExceptionPort,
  InMemoryWorkflowRunStore,
} from "./memory";
import type { CoreWorkflowDependencies } from "./ports";
import {
  IssueInvoiceInputSchema,
  PartnerCreditInputSchema,
  SyncOverageInputSchema,
} from "./schemas";

const idsFixture = {
  partner: ids.account.parse("a0000000-0000-4000-8000-000000000001"),
  clientOne: ids.account.parse("a0000000-0000-4000-8000-000000000002"),
  clientTwo: ids.account.parse("a0000000-0000-4000-8000-000000000003"),
  order: ids.order.parse("b0000000-0000-4000-8000-000000000001"),
  invoice: ids.invoice.parse("c0000000-0000-4000-8000-000000000001"),
  ledger: ids.commitmentLedger.parse("d0000000-0000-4000-8000-000000000001"),
  ledgerEntry: ids.commitmentEntry.parse(
    "d0000000-0000-4000-8000-000000000002",
  ),
};

const occurredAt = "2026-07-31T16:00:00.000Z";
const workflowContext = (aggregateId: string, aggregateVersion: number) => ({
  aggregateId,
  aggregateVersion,
  requestId: ids.request.parse(`request-${aggregateId}-${aggregateVersion}`),
  occurredAt,
});

const success = <T>(value: T): ProviderResult<T> => ({ ok: true, value });

describe("partner consolidated billing money path", () => {
  it("credit-checks new service, groups one partner invoice, and syncs ledger-authoritative overage exactly once", async () => {
    const kernel = new FakeProviderKernel();
    const providers = createFakeProviderPorts(kernel);
    const records = new InMemoryCoreWorkflowRecordPort();
    const meteringCalls: Parameters<
      CoreWorkflowDependencies["metering"]["syncOverage"]
    >[0][] = [];
    const dependencies: CoreWorkflowDependencies = {
      runs: new InMemoryWorkflowRunStore(),
      exceptions: new InMemoryWorkflowExceptionPort(),
      records,
      billing: providers.billing,
      accounting: providers.accounting,
      notifications: providers.notifications,
      usage: providers.usage,
      exports: providers.evidence,
      metering: {
        syncOverage: (input) => {
          meteringCalls.push(input);
          return Promise.resolve(
            success({
              providerInvoiceItemIds: ["ii_overage_1"],
              duplicateSourceUsageIds: [],
            }),
          );
        },
      },
      reporting: {
        query: () =>
          Promise.resolve(success({ rows: [], sourceVersion: "unused" })),
      },
    };
    const engine = new CoreFinanceWorkflowEngine(dependencies);

    const creditInput = PartnerCreditInputSchema.parse({
      context: workflowContext(idsFixture.order, 3),
      partnerAccountId: idsFixture.partner,
      orderId: idsFixture.order,
      serviceKind: "new_end_client",
      creditPolicy: "auto_charge",
      currency: "USD",
      currentExposureMinor: "20000",
      requestedExposureMinor: "15000",
      creditLimitMinor: "50000",
      hasRequiredPaymentHistory: false,
      collectionsOwner: "collections@clockwork.test",
    });
    const credit = await engine.evaluatePartnerCredit(creditInput);
    expect(credit).toMatchObject({
      status: "completed",
      value: { decision: { allowNewService: true, reason: "within_policy" } },
    });

    const invoiceInput = IssueInvoiceInputSchema.parse({
      context: workflowContext(idsFixture.invoice, 2),
      invoiceId: idsFixture.invoice,
      orderId: idsFixture.order,
      billingAccountId: idsFixture.partner,
      customerId: "cus_partner_only",
      commercialShape: "resale",
      collectionMethod: "auto_charge",
      amount: { currency: "USD", minor: "15000" },
      vendorSetupComplete: false,
      groups: [
        {
          endClientAccountId: idsFixture.clientOne,
          amount: { currency: "USD", minor: "9000" },
          description: "Client One committed storage",
        },
        {
          endClientAccountId: idsFixture.clientTwo,
          amount: { currency: "USD", minor: "6000" },
          description: "Client Two committed storage",
        },
      ],
    });
    const invoice = await engine.issueInvoice(invoiceInput);
    const invoiceReplay = await engine.issueInvoice(invoiceInput);
    expect(invoice).toMatchObject({ status: "completed", duplicate: false });
    expect(invoiceReplay).toMatchObject({
      status: "completed",
      duplicate: true,
    });

    const overageInput = SyncOverageInputSchema.parse({
      context: workflowContext(idsFixture.ledger, 12),
      ledgerId: idsFixture.ledger,
      orderId: idsFixture.order,
      invoiceId: idsFixture.invoice,
      providerInvoiceId: "in_partner_consolidated",
      customerId: "cus_partner_only",
      periodStart: "2026-07-01T00:00:00.000Z",
      periodEnd: "2026-08-01T00:00:00.000Z",
      lines: [
        {
          ledgerEntryId: idsFixture.ledgerEntry,
          sku: "LOCKED-STORAGE-TB-MO",
          taxCode: "txcd_10103001",
          quantity: "1.25",
          contractedUnitRate: { currency: "USD", minor: "800" },
          amount: { currency: "USD", minor: "1000" },
          sourceUsageIds: ["usage-partner-client-one-2026-07"],
        },
      ],
    });
    const overage = await engine.syncOverage(overageInput);
    const overageReplay = await engine.syncOverage(overageInput);
    expect(overage).toMatchObject({
      status: "completed",
      duplicate: false,
      value: { providerInvoiceItemIds: ["ii_overage_1"] },
    });
    expect(overageReplay).toMatchObject({
      status: "completed",
      duplicate: true,
    });

    const billingCalls = kernel.calls.filter(
      ({ operation }) => operation === "billing.issueInvoice",
    );
    expect(billingCalls).toHaveLength(1);
    expect(billingCalls[0]?.input).toMatchObject({
      customerId: "cus_partner_only",
      amount: { currency: "USD", minor: "15000" },
    });
    expect(meteringCalls).toHaveLength(1);
    expect(meteringCalls[0]).toMatchObject({
      customerId: "cus_partner_only",
      lines: [
        {
          taxCode: "txcd_10103001",
          contractedUnitRate: { currency: "USD", minor: "800" },
          amount: { currency: "USD", minor: "1000" },
          sourceUsageIds: ["usage-partner-client-one-2026-07"],
        },
      ],
    });
    expect(records.records.map(({ record }) => record.kind)).toEqual([
      "partner_credit_decided",
      "invoice_issued",
      "overage_synced",
    ]);
  });
});
