import { createHash } from "node:crypto";

import {
  EventEnvelopeSchema,
  IdempotencyKeySchema,
  ids,
  MoneySchema,
  type ProviderResult,
} from "@clockwork/contracts";
import {
  acceptOrder,
  assertQuoteSnapshotUnchanged,
  createQuoteDraft,
  issueQuote,
  orderRevenue,
  priceQuote,
  projectStripeTruth,
  provisioningRequest,
  type AccountCommercialRecord,
  type PriceBook,
} from "@clockwork/domain/core";
import {
  approveAgreementTemplate,
  captureClickAcceptance,
  createAgreementTemplate,
  createOurPaperAgreement,
  executeClickThroughAgreement,
  hashEvidence,
  hashExactText,
  type ImmutableEvidenceObject,
  type KeyTerms,
} from "@clockwork/domain/lifecycle";
import { createFakeProviderPorts } from "@clockwork/integrations/fakes";
import { FakeWorkosIdentityAdapter } from "@clockwork/integrations/lifecycle";
import { describe, expect, it } from "vitest";

function value<T>(result: ProviderResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.value;
}

const accountId = ids.account.parse("10000000-0000-4000-8000-000000000001");
const organizationId = ids.organization.parse(
  "10000000-0000-4000-8000-000000000002",
);
const userId = ids.user.parse("10000000-0000-4000-8000-000000000003");
const orderId = ids.order.parse("10000000-0000-4000-8000-000000000004");
const invoiceId = ids.invoice.parse("10000000-0000-4000-8000-000000000005");
const idempotency = (suffix: string) =>
  IdempotencyKeySchema.parse(`release-direct-${suffix}`);
const now = "2026-07-31T16:00:00.000Z";

const money = (minor: string) => MoneySchema.parse({ currency: "USD", minor });

const account: AccountCommercialRecord = {
  id: accountId,
  legalName: "Northstar Archive Ltd",
  country: "US",
  domain: "northstar.example",
  roles: ["direct_client"],
  taxIds: [],
  contacts: [
    {
      name: "Ada Buyer",
      email: "ada@northstar.example",
      roles: ["billing", "accounts_payable"],
    },
  ],
  currency: "USD",
  paymentTerms: { kind: "auto_charge" },
  procurement: {
    poRequired: true,
    apContactEmail: "ap@northstar.example",
    invoiceDeliveryEmail: "ap@northstar.example",
    supplierPortalStatus: "complete",
    certificates: [],
    furnishedDocuments: [],
  },
  rowVersion: 1,
};

const priceBook: PriceBook = {
  id: "price-book-usd-2026",
  name: "USD 2026",
  version: 1,
  currency: "USD",
  effectiveFrom: "2026-01-01",
  status: "active",
  rateCards: [
    {
      id: "storage-us-east-v1",
      sku: "LOCKED-STORAGE-TB",
      region: "us-east",
      unit: "TB-month",
      approvedClaim: "Object storage capacity",
      unitPrice: money("10000"),
      floorPrice: money("8000"),
      overageRate: money("12000"),
      minimumQuantity: "1",
      egressTreatment: "metered",
      commitType: "period_allowance",
      stripeTaxCode: "txcd_10103101",
      qboIncomeAccount: "Storage Revenue",
      partnerTransferPrices: {},
    },
  ],
};

const keyTerms: KeyTerms = {
  slaCreditSchedule: { availability_99_9: "10_percent" },
  liabilityCap: money("1000000"),
  breachNoticeHours: 24,
  renewalPriceProtectionBasisPoints: 500,
  auditRights: "Annual audit on thirty days notice.",
  retentionLiabilityRule: "liable_through_retention",
  customRetentionRule: null,
  survivalRules: [
    {
      clause: "payment",
      customClause: null,
      duration: { kind: "in_flight_orders" },
    },
  ],
  customTerms: {},
};

describe("direct purchase through real domain and provider boundaries", () => {
  it("completes the direct artifact chain and remains replay safe", async () => {
    const providers = createFakeProviderPorts();
    const workos = new FakeWorkosIdentityAdapter();
    workos.authorizeDomain("northstar.example", "domain-proof");

    const organization = value(
      await workos.createOrganization({
        commerceOrganizationId: organizationId,
        legalName: account.legalName,
        idempotencyKey: idempotency("workos-org"),
      }),
    );
    expect(
      value(
        await workos.verifyBusinessDomain({
          organizationId: organization.id,
          domain: account.domain,
          verificationToken: "domain-proof",
        }),
      ),
    ).toEqual({ domain: account.domain, verified: true });
    expect(
      value(
        await providers.screening.screen({
          accountId,
          legalName: account.legalName,
          country: account.country,
          reason: "registration",
        }),
      ).decision,
    ).toBe("clear");

    const legalText = "Cloud Service Agreement\nVersion 1.0.0\n";
    const legalBytes = new TextEncoder().encode(legalText);
    const legalHash = hashExactText(legalText);
    const storedLegalText = value(
      await providers.evidence.putImmutable({
        kind: "canonical_text",
        bytes: legalBytes,
        contentHash: legalHash,
        retainUntil: "2036-07-31T16:00:00.000Z",
        legalHold: false,
      }),
    );
    const legalEvidence: ImmutableEvidenceObject = {
      documentId: storedLegalText.documentId,
      kind: "canonical_text",
      sha256: legalHash,
      storageKey: storedLegalText.storageKey,
      versionId: storedLegalText.versionId,
      retainedUntil: "2036-07-31T16:00:00.000Z",
      legalHold: false,
      malwareScan: "clean",
      recordedAt: now,
    };
    const draftTemplate = createAgreementTemplate({
      id: "csa-us-1.0.0",
      seriesId: "csa-us",
      type: "csa",
      semanticVersion: "1.0.0",
      jurisdiction: "US",
      variant: "standard",
      effectiveOn: "2026-07-31",
      executionMode: "click_through",
      canonicalText: legalText,
      canonicalDocument: legalEvidence,
      createdAt: now,
    });
    const template = approveAgreementTemplate(draftTemplate, {
      approvalId: "counsel-approval-csa-us-1",
      approverUserId: "counsel-user",
      authority: "counsel",
      approvedAt: now,
      reviewedTextHash: draftTemplate.textHash,
      note: "Approved exact canonical text.",
    });
    const agreementDraft = createOurPaperAgreement({
      id: "agreement-northstar-1",
      accountId,
      legalEntityName: account.legalName,
      template,
      term: {
        startsOn: "2026-08-01",
        endsOn: "2027-07-31",
        renewalType: "auto_renew",
        renewalMonths: 12,
        noticeDays: 60,
        timeZone: "America/New_York",
      },
      createdAt: now,
    });
    const valueSnapshot = {
      snapshotId: "ledger-snapshot-direct-1",
      accountId,
      source: "commerce_ledger" as const,
      capturedAt: now,
      commercialEventId: "quote-direct-1",
      cumulativeValueBeforeMinor: "0",
      commercialEventValueMinor: "120000",
      currency: "USD" as const,
    };
    const clickEvidence = captureClickAcceptance({
      evidenceId: "click-evidence-direct-1",
      agreementId: agreementDraft.id,
      legalEntityName: account.legalName,
      template,
      exactTextPresented: legalText,
      identity: {
        userId,
        email: "ada@northstar.example",
        role: "owner",
        accountId,
        organizationId,
      },
      acceptedAt: "2026-07-31T16:05:00.000Z",
      ipAddress: "192.0.2.10",
      uiContext: {
        route: "/agreements/agreement-northstar-1/accept",
        action: "accept_agreement",
        sessionId: "session-direct-1",
        requestId: "request-direct-1",
        userAgent: "Clockwork release test",
        locale: "en-US",
      },
      authorityTitle: "Chief Financial Officer",
      authorityAttested: true,
      commercialValueSnapshot: {
        ...valueSnapshot,
        evidenceHash: hashEvidence(valueSnapshot),
      },
      thresholdMinor: "1000000",
    });
    const agreement = executeClickThroughAgreement(
      agreementDraft,
      clickEvidence,
      keyTerms,
    );
    expect(agreement.executionEvidence.kind).toBe("click_through");
    if (agreement.executionEvidence.kind !== "click_through")
      throw new Error("Expected click-through execution evidence");
    expect(agreement.executionEvidence.templateTextHash).toBe(legalHash);

    const priced = priceQuote({
      book: priceBook,
      route: "direct",
      quotedAt: "2026-07-31T16:10:00.000Z",
      lines: [
        {
          lineId: "quote-line-direct-1",
          sku: "LOCKED-STORAGE-TB",
          region: "us-east",
          quantity: "1",
          termMonths: 12,
        },
      ],
    });
    const quotePdf = new TextEncoder().encode("immutable quote PDF fixture");
    const storedQuote = value(
      await providers.evidence.putImmutable({
        kind: "quote_pdf",
        bytes: quotePdf,
        contentHash: createHash("sha256").update(quotePdf).digest("hex"),
        retainUntil: "2036-07-31T16:00:00.000Z",
      }),
    );
    const quote = issueQuote(
      createQuoteDraft({
        id: "quote-direct-1",
        seriesId: "quote-direct-series-1",
        accountId,
        priceBook: { id: priceBook.id, version: priceBook.version },
        route: "direct",
        lines: priced.lines,
        total: priced.total,
        marginResult: priced.marginResult,
        exceptionReasons: priced.exceptionReasons,
        expiresAt: "2026-08-31T16:00:00.000Z",
        createdBy: userId,
        createdAt: "2026-07-31T16:10:00.000Z",
      }),
      {
        issuedAt: "2026-07-31T16:11:00.000Z",
        renderedDocumentId: storedQuote.documentId,
      },
    );
    expect(() =>
      assertQuoteSnapshotUnchanged({ ...quote, total: money("1") }),
    ).toThrow("Issued quote snapshot was mutated");

    const order = acceptOrder({
      orderId,
      quote,
      agreement: {
        id: agreement.id,
        accountId: agreement.accountId,
        version: agreement.lifecycleVersion,
        status: "active",
        effectiveOn: agreement.effectiveOn,
      },
      buyer: account,
      signerUserId: userId,
      authorityTitle: "Chief Financial Officer",
      authorityAttested: true,
      poNumber: "PO-2026-100",
      poDocumentId: "po-document-direct-1",
      serviceStartsOn: "2026-08-01",
      serviceEndsOn: "2027-07-31",
      acceptedAt: "2026-07-31T16:15:00.000Z",
      orderFormDocumentId: "order-form-direct-1",
      orderLineIds: ["order-line-direct-1"],
    });
    const provisioned = value(
      await providers.provisioning.provision(
        provisioningRequest(order, organizationId),
      ),
    );
    expect(provisioned.operationId).toMatch(/^provision_fake_/);

    const customer = value(
      await providers.billing.createCustomer({
        accountId,
        email: "ap@northstar.example",
        idempotencyKey: idempotency("billing-customer"),
      }),
    );
    const invoice = value(
      await providers.billing.issueInvoice({
        invoiceId,
        customerId: customer.customerId,
        orderId,
        amount: orderRevenue(order),
        ...(order.poNumber ? { poNumber: order.poNumber } : {}),
        idempotencyKey: idempotency("billing-invoice"),
      }),
    );
    expect(invoice.status).toBe("open");
    expect(
      value(
        await providers.accounting.postInvoice({
          invoiceId,
          mode: "accounts_receivable",
          idempotencyKey: idempotency("qbo-invoice"),
        }),
      ).postingId,
    ).toMatch(/^posting_fake_/);

    const event = EventEnvelopeSchema.parse({
      id: "10000000-0000-4000-8000-000000000006",
      specVersion: "1.0",
      eventVersion: 1,
      type: "order.accepted",
      occurredAt: "2026-07-31T16:15:00.000Z",
      requestId: "request-direct-1",
      aggregate: { type: "order", id: orderId, version: 1 },
      actor: { kind: "user", id: userId },
      data: { accountId, quoteId: quote.id, invoiceId },
      metadata: {},
    });
    expect(value(await providers.crm.projectEvent(event)).projectionId).toMatch(
      /^crm_fake_/,
    );
    expect(
      value(
        await providers.notifications.send({
          template: "order-confirmed",
          recipients: ["ada@northstar.example"],
          data: { orderId },
          idempotencyKey: idempotency("notification"),
        }),
      ).messageId,
    ).toMatch(/^msg_fake_/);
    expect(
      value(await providers.support.listSignals({ accountId })),
    ).toHaveLength(1);

    const paymentTruth = projectStripeTruth([
      {
        id: "evt-paid",
        type: "invoice.paid",
        created: 3,
        objectId: invoice.providerInvoiceId,
        status: "paid",
        amountMinor: orderRevenue(order).minor,
        currency: "USD",
      },
      {
        id: "evt-open-delayed",
        type: "invoice.open",
        created: 2,
        objectId: invoice.providerInvoiceId,
        status: "open",
      },
      {
        id: "evt-paid",
        type: "invoice.paid",
        created: 3,
        objectId: invoice.providerInvoiceId,
        status: "paid",
      },
    ]);
    expect(paymentTruth.projections[invoice.providerInvoiceId]?.status).toBe(
      "paid",
    );
    expect(paymentTruth.duplicates).toEqual(["evt-paid"]);
    expect(paymentTruth.ignoredOutOfOrder).toEqual(["evt-open-delayed"]);

    expect(providers.kernel.calls.map(({ operation }) => operation)).toEqual(
      expect.arrayContaining([
        "screening.screen",
        "evidence.putImmutable",
        "provisioning.provision",
        "billing.createCustomer",
        "billing.issueInvoice",
        "accounting.postInvoice",
        "crm.projectEvent",
        "notifications.send",
        "support.listSignals",
      ]),
    );
  });
});
