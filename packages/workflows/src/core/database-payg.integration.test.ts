import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  createRuntimeDatabase,
  DatabasePaygOfferRepository,
  DatabasePaygInvoiceRepository,
  DatabaseCoreWorkflowDispatchStore,
  DatabaseCoreWorkflowRecordPort,
  DatabaseStripeFinancialProjection,
  DatabasePersistedStripeAdjustmentStore,
  creditNotes,
  payments,
  webhookEvents,
  loadInvoiceDerivation,
  invoices,
  outboxMessages,
  withInternalTransaction,
  commerceUsers,
  accounts,
  memberships,
} from "@clockwork/db";
import {
  accountTaxIdentifiers,
  paygPeriodRevisions,
  paygSourceMeasurements,
  paygCreditSources,
  stripeAdjustmentOperations,
  billingPolicies,
} from "@clockwork/db/schema";
import {
  PaygOfferTermsSchema,
  type PaygMeasurement,
  type PaygOfferRecord,
} from "@clockwork/domain/core";
import { IdempotencyKeySchema } from "@clockwork/contracts";
import { IssueInvoiceInputSchema } from "./schemas";
import { DatabasePaygBillingRepository } from "./database-payg";
import { closePaygPeriod } from "./payg";

const { db, client } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  role: "clockwork_service",
  ssl: false,
});
const repository = new DatabasePaygBillingRepository(db);
const invoiceRepository = new DatabasePaygInvoiceRepository(db);
const policies = new DatabasePaygOfferRepository(db);
const creator = randomUUID();
const approver = randomUUID();
const enrollmentId = randomUUID();
const runId = randomUUID();
const now = "2026-09-02T00:00:00.000Z";
let offer: PaygOfferRecord;
const testAccountId = randomUUID();
const source = `payg-test-${runId}`;
const event: PaygMeasurement = {
  sourceMeasurementId: randomUUID(),
  source,
  filOneOrganizationId: "verified-fil-one-org",
  tenantId: "verified-tenant",
  entitlementId: `entitlement-${runId}`,
  sku: `PAYG-${runId}`,
  region: "test-region",
  meter: "storage_bytes",
  startsAt: "2026-09-01T00:00:00.000Z",
  endsAt: "2026-09-01T01:00:00.000Z",
  quantity: "720000000000000",
  recordedAt: "2026-09-01T01:00:00.000Z",
  kind: "usage",
};
const receipt = {
  enrollmentId,
  receiptId: randomUUID(),
  verificationEvidenceId: "verified-raw-signature-record",
  measurements: [event],
  closedThrough: now,
  completeCountMeters: ["egress_bytes", "api_operations"] as const,
  now,
};
const close = (at = now) =>
  closePaygPeriod({ repository, enrollmentId, month: "2026-09", now: at });

beforeAll(async () => {
  await withInternalTransaction(db, randomUUID(), async (tx) => {
    const [template] = await tx
      .select()
      .from(accounts)
      .where(eq(accounts.id, "10000000-0000-4000-8000-000000000003"));
    if (!template) throw new Error("Missing seeded account fixture");
    await tx.insert(accounts).values({
      ...template,
      id: testAccountId,
      legalName: `PAYG fixture ${runId}`,
      domain: `${runId}.clockwork.test`,
      stripeCustomerId: `cus_payg_${runId}`,
    });
    const [policy] = await tx
      .select()
      .from(billingPolicies)
      .where(eq(billingPolicies.accountId, template.id));
    if (!policy) throw new Error("Missing seeded billing policy fixture");
    await tx.insert(billingPolicies).values({
      ...policy,
      accountId: testAccountId,
      collectionMethod: "auto_charge",
      requireVendorSetup: false,
      termsDays: null,
    });
    await tx.insert(accountTaxIdentifiers).values({
      id: randomUUID(),
      accountId: testAccountId,
      jurisdiction: "ES",
      type: "vat",
      normalizedValue: `ES-FIXTURE-${runId}`,
      validationStatus: "valid",
      verificationReference: "fixture:verified-business-registration",
      validatedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    for (const id of [creator, approver]) {
      await tx.insert(commerceUsers).values({
        id,
        workosUserId: `payg-billing-${id}`,
        email: `payg-billing-${id}@clockwork.test`,
        name: "PAYG billing test",
        isInternalStaff: true,
        mfaEnrolled: true,
      });
      await tx.insert(memberships).values({
        userId: id,
        organizationId: "30000000-0000-4000-8000-000000000008",
        role: "finance_approver",
      });
    }
  });
  const terms = PaygOfferTermsSchema.parse({
    name: "PAYG durable integration",
    sku: event.sku,
    region: event.region,
    version: 1,
    effectiveFrom: "2026-09-01",
    sourceUri: "https://docs.fil.one/billing/trial",
    sourceCheckedAt: "2026-09-01T00:00:00.000Z",
    sourceDocumentId: "test-source",
    owner: "Test finance",
    payg: {
      currency: "USD",
      storageTbMonthMinor: "499",
      monthlyMinimumMinor: "499",
      partialMonthMinimum: "full",
      correctionWindowDays: 30,
      aggregation: "hourly_average_daily_utc",
      egressRateMinor: "0",
      apiRateMinor: "0",
      stripeTaxCode: "txcd_demo",
      qboIncomeAccount: "4000-Storage",
    },
    trial: {
      durationDays: 30,
      gracePeriodDays: 7,
      storageLimitBytes: "1000000000000",
      cumulativeEgressLimitBytes: "2000000000000",
      maximumCounterAgeSeconds: 60,
      egressExhaustion: "disable_all",
    },
  });
  offer = await policies.command({
    command: { action: "create", terms },
    actor: { kind: "user", id: creator },
    requestId: randomUUID(),
    now,
  });
  offer = await policies.command({
    command: {
      action: "propose",
      id: offer.id,
      expectedRowVersion: offer.rowVersion,
      reason: "Ready for test qualification",
    },
    actor: { kind: "user", id: creator },
    requestId: randomUUID(),
    now,
  });
  offer = await policies.command({
    command: {
      action: "approve",
      id: offer.id,
      expectedRowVersion: offer.rowVersion,
      reason: "Approved test fixture only",
      approvalEvidenceId: "test-policy-evidence",
    },
    actor: { kind: "user", id: approver },
    requestId: randomUUID(),
    now,
  });
  await repository.enroll({
    id: enrollmentId,
    offerVersionId: offer.id,
    binding: {
      mappingVersionId: "verified-mapping",
      accountId: testAccountId,
      filOneOrganizationId: event.filOneOrganizationId,
      tenantId: event.tenantId,
      entitlementId: event.entitlementId,
      sku: event.sku,
      region: event.region,
      source,
      meters: ["storage_bytes", "egress_bytes", "api_operations"],
      status: "active",
    },
    bindingEvidenceId: "verified-identity-mapping",
    startsAt: event.startsAt,
    billingAuthority: "clockwork",
    cutoverEvidenceId: "approved-cutover",
    now,
  });
  await repository.confirmCancellation({
    enrollmentId,
    serviceEndsAt: event.endsAt,
    evidenceId: "confirmed-service-end",
    now,
  });
});
afterAll(async () => client.end());

describe.sequential("durable PAYG source and monthly ledger", () => {
  it("retains authenticated receipt evidence, deduplicates, and rejects conflicting source IDs", async () => {
    expect(await repository.ingestVerifiedReceipt(receipt)).toEqual({
      replay: false,
      acceptedMeasurements: 1,
    });
    expect(await repository.ingestVerifiedReceipt(receipt)).toEqual({
      replay: true,
      acceptedMeasurements: 0,
    });
    await expect(
      repository.ingestVerifiedReceipt({
        ...receipt,
        measurements: [{ ...event, quantity: "1" }],
      }),
    ).rejects.toThrow("PAYG_RECEIPT_PAYLOAD_CONFLICT");
    await expect(
      repository.ingestVerifiedReceipt({
        ...receipt,
        receiptId: randomUUID(),
        measurements: [{ ...event, quantity: "1" }],
      }),
    ).rejects.toThrow("PAYG_SOURCE_ID_PAYLOAD_CONFLICT");
  });
  it("database locking yields one final period and exposes its pending invoice plan", async () => {
    const results = await Promise.all([close(), close(), close()]);
    expect(results.filter((result) => result.replay)).toHaveLength(2);
    const rows = await withInternalTransaction(db, randomUUID(), (tx) =>
      tx
        .select()
        .from(paygPeriodRevisions)
        .where(eq(paygPeriodRevisions.enrollmentId, enrollmentId)),
    );
    expect(rows).toHaveLength(1);
    const pending = (await repository.listPendingEffects()).filter(
      (row) => row.effect.enrollmentId === enrollmentId,
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      status: "awaiting_materialization",
      effect: { kind: "invoice", amount: { minor: "499" } },
      rating: { period: { final: true } },
    });
  });
  it("persists append-only corrections and rates a debit difference", async () => {
    const correction: PaygMeasurement = {
      ...event,
      sourceMeasurementId: randomUUID(),
      kind: "correction",
      correctsSourceMeasurementId: event.sourceMeasurementId,
      quantity: "720000000000000",
    };
    await repository.ingestVerifiedReceipt({
      ...receipt,
      receiptId: randomUUID(),
      measurements: [correction],
    });
    expect((await close()).effect).toMatchObject({
      kind: "debit_adjustment",
      amount: { minor: "499" },
    });
    await expect(
      withInternalTransaction(db, randomUUID(), (tx) =>
        tx
          .update(paygSourceMeasurements)
          .set({ payload: { ...event, quantity: "0" } })
          .where(
            eq(
              paygSourceMeasurements.sourceMeasurementId,
              event.sourceMeasurementId,
            ),
          ),
      ),
    ).rejects.toThrow();
  });
  it("materializes each positive delta once into the unified invoice and provider outbox", async () => {
    const effects = (await invoiceRepository.listPending()).filter(
      (effect) => effect.enrollmentId === enrollmentId,
    );
    expect(effects).toHaveLength(2);
    for (const effect of effects) {
      const input = {
        effectKey: effect.idempotencyKey,
        actor: { kind: "user" as const, id: approver },
        requestId: randomUUID(),
        now,
      };
      const results = await Promise.all([
        invoiceRepository.materialize(input),
        invoiceRepository.materialize({ ...input, requestId: randomUUID() }),
      ]);
      expect(results.filter((result) => result.replay)).toHaveLength(1);
      const [result] = results;
      if (!result) throw new Error("Missing invoice result");
      const [invoice] = await withInternalTransaction(db, randomUUID(), (tx) =>
        tx.select().from(invoices).where(eq(invoices.id, result.invoiceId)),
      );
      expect(invoice).toMatchObject({
        billingSource: "payg",
        orderId: null,
        paygEffectKey: effect.idempotencyKey,
        status: "draft",
        amountMinor: 499n,
      });
      if (!invoice) throw new Error("Missing materialized invoice");
      const dispatched = await new DatabaseCoreWorkflowDispatchStore(
        db,
        process.env.AUTHORIZATION_CONTEXT_SECRET ??
          "clockwork-local-auth-context-secret-change-me",
      ).buildIssueInvoiceDispatch({
        invoiceId: invoice.id,
        context: {
          aggregateId: invoice.id,
          aggregateVersion: invoice.rowVersion,
          requestId: randomUUID(),
          occurredAt: now,
        },
        idempotencyKey: `payg-integration:${invoice.id}`,
      });
      const command = IssueInvoiceInputSchema.parse(dispatched.payload);
      expect(command.orderId).toBeUndefined();
      expect(command.paygSource).toMatchObject({
        enrollmentId,
        effectKey: effect.idempotencyKey,
      });
      const issued = {
        invocationKey: IdempotencyKeySchema.parse(`payg-issue:${invoice.id}`),
        aggregateId: invoice.id,
        aggregateVersion: invoice.rowVersion,
        requestId: randomUUID(),
        occurredAt: now,
        record: {
          kind: "invoice_issued",
          taskId: dispatched.taskId,
          input: command,
          providerInvoiceId: `in_payg_${invoice.id}`,
          providerStatus: "open",
          ...(command.collectionMethod === "net_terms"
            ? { accountingPostingId: `qbo_${invoice.id}` }
            : {}),
        },
      };
      const records = new DatabaseCoreWorkflowRecordPort(db);
      await expect(
        records.record({
          ...issued,
          invocationKey: IdempotencyKeySchema.parse(
            `payg-wrong-source:${invoice.id}`,
          ),
          record: {
            ...issued.record,
            input: {
              ...command,
              paygSource: {
                ...command.paygSource,
                effectKey: "unrelated-effect",
              },
            },
          },
        }),
      ).rejects.toThrow("INVOICE_WORKFLOW_SOURCE_MISMATCH");
      await records.record(issued);
      await expect(records.record(issued)).resolves.toEqual({
        duplicate: true,
      });
      const paid = {
        eventId: `evt_payg_${invoice.id}`,
        eventType: "payment_intent.succeeded",
        category: "payment" as const,
        aggregateKey: `pi_payg_${invoice.id}`,
        occurredAt: now,
        invoiceId: `in_payg_${invoice.id}`,
        paymentIntentId: `pi_payg_${invoice.id}`,
        customerId: command.customerId,
        amount: command.amount,
        status: "succeeded",
      };
      await withInternalTransaction(db, randomUUID(), async (tx) => {
        await tx.insert(webhookEvents).values({
          provider: "stripe",
          providerEventId: paid.eventId,
          eventType: paid.eventType,
          signatureVerifiedAt: new Date(now),
          payloadHash: "a".repeat(64),
          payload: {
            type: paid.eventType,
            event: { provider: "stripe", ...paid },
          },
          occurredAt: new Date(now),
          lockedUntil: new Date(now),
        });
      });
      const projection = new DatabaseStripeFinancialProjection(db);
      await projection.apply(paid);
      await projection.apply(paid);
      const settled = await withInternalTransaction(
        db,
        randomUUID(),
        async (tx) => ({
          payments: await tx
            .select()
            .from(payments)
            .where(eq(payments.invoiceId, invoice.id)),
          invoice: await tx.query.invoices.findFirst({
            where: eq(invoices.id, invoice.id),
          }),
          derivation: await loadInvoiceDerivation(tx, invoice.id),
          collections: await tx.execute(sql`
            select invoice_id, order_id, account_id, partner_account_id,
              invoicing_account_id, channel, invoice_status, collected_minor::text,
              outstanding_minor::text, source_record_ids
            from public.core_billing_collections where invoice_id=${invoice.id}::uuid
          `),
        }),
      );
      expect(settled.payments).toHaveLength(1);
      expect(settled.payments[0]).toMatchObject({
        orderId: null,
        amountMinor: 499n,
        status: "succeeded",
      });
      expect(settled.invoice).toMatchObject({
        status: "paid",
        amountRemainingMinor: 0n,
      });
      expect(settled.derivation).toMatchObject({
        billingSource: "payg",
        invoicedTotalMinor: "499",
        month: effect.month,
        revision: effect.revision,
      });
      expect([...settled.collections]).toEqual([
        expect.objectContaining({
          invoice_id: invoice.id,
          order_id: null,
          account_id: testAccountId,
          partner_account_id: null,
          invoicing_account_id: testAccountId,
          channel: "direct",
          invoice_status: "paid",
          collected_minor: "499",
          outstanding_minor: "0",
        }),
      ]);
      expect(settled.collections[0]?.source_record_ids).toMatchObject({
        invoiceId: invoice.id,
        orderId: null,
        billingSource: "payg",
        paygEnrollmentId: enrollmentId,
        paygEffectKey: effect.idempotencyKey,
      });
      const messages = await withInternalTransaction(db, randomUUID(), (tx) =>
        tx
          .select()
          .from(outboxMessages)
          .where(eq(outboxMessages.topic, "core.invoices.create")),
      );
      expect(
        messages.filter(
          (message) =>
            (message.payload as { aggregateId: string }).aggregateId ===
            result.invoiceId,
        ),
      ).toHaveLength(1);
    }
    expect(
      (await invoiceRepository.listPending()).filter(
        (effect) => effect.enrollmentId === enrollmentId,
      ),
    ).toHaveLength(0);
  });
  it("allocates a negative correction once and reconciles the provider credit without a term order", async () => {
    await repository.ingestVerifiedReceipt({
      ...receipt,
      receiptId: randomUUID(),
      measurements: [
        {
          ...event,
          sourceMeasurementId: randomUUID(),
          kind: "correction",
          correctsSourceMeasurementId: event.sourceMeasurementId,
          quantity: "-720000000000000",
        },
      ],
    });
    const closed = await close();
    expect(closed.effect).toMatchObject({
      kind: "credit_adjustment",
      amount: { minor: "499" },
    });
    if (!closed.effect) throw new Error("Missing credit effect");
    const request = {
      effectKey: closed.effect.idempotencyKey,
      actor: { kind: "user" as const, id: approver },
      requestId: randomUUID(),
      now,
    };
    const materialized = await invoiceRepository.materialize(request);
    await expect(
      invoiceRepository.materialize({ ...request, requestId: randomUUID() }),
    ).resolves.toMatchObject({
      replay: true,
      invoiceId: materialized.invoiceId,
    });
    const state = await withInternalTransaction(
      db,
      randomUUID(),
      async (tx) => {
        const allocations = await tx
          .select()
          .from(paygCreditSources)
          .where(eq(paygCreditSources.effectKey, request.effectKey));
        const allocation = allocations[0];
        if (!allocation) throw new Error("Missing credit allocation");
        return {
          allocations,
          credit: await tx.query.creditNotes.findFirst({
            where: eq(creditNotes.id, allocation.creditNoteId),
          }),
          operation: await tx.query.stripeAdjustmentOperations.findFirst({
            where: eq(
              stripeAdjustmentOperations.adjustmentId,
              allocation.creditNoteId,
            ),
          }),
        };
      },
    );
    expect(state.allocations).toHaveLength(1);
    expect(state.allocations[0]).toMatchObject({
      netMinor: 499n,
      taxMinor: 0n,
      amountMinor: 499n,
    });
    expect(state.credit).toMatchObject({
      orderId: null,
      status: "approved",
      amountMinor: 499n,
    });
    expect(state.operation).toMatchObject({
      orderId: null,
      kind: "credit_note",
      amountMinor: 499n,
    });
    if (!state.credit || !state.operation)
      throw new Error("Missing credit command");
    const store = new DatabasePersistedStripeAdjustmentStore(db);
    const claim = await store.claim({
      adjustmentId: state.credit.id,
      expectedVersion: state.operation.commandVersion,
    });
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") throw new Error("Credit not claimed");
    expect(claim.operation).toMatchObject({
      orderId: null,
      invoiceId: state.credit.invoiceId,
      amount: { minor: "499" },
    });
    const creditId = state.credit.id;
    const providerId = `cn_payg_${creditId}`;
    await store.recordProviderAcceptance({
      adjustmentId: state.credit.id,
      leaseToken: claim.leaseToken,
      providerObjectId: providerId,
      providerStatus: "issued",
    });
    const credited = {
      eventId: `evt_${providerId}`,
      eventType: "credit_note.created",
      category: "credit_note" as const,
      aggregateKey: providerId,
      occurredAt: now,
      invoiceId: claim.operation.providerInvoiceId ?? "",
      creditNoteId: providerId,
      amount: { currency: "EUR", minor: "499" },
      status: "issued",
    };
    credited.amount.currency = state.credit.currency;
    await withInternalTransaction(db, randomUUID(), async (tx) => {
      await tx.insert(webhookEvents).values({
        provider: "stripe",
        providerEventId: credited.eventId,
        eventType: credited.eventType,
        signatureVerifiedAt: new Date(now),
        payloadHash: "a".repeat(64),
        payload: {
          type: credited.eventType,
          event: { provider: "stripe", ...credited },
        },
        occurredAt: new Date(now),
        lockedUntil: new Date(now),
      });
    });
    const projection = new DatabaseStripeFinancialProjection(db);
    await projection.apply(credited);
    await projection.apply(credited);
    const credit = await withInternalTransaction(db, randomUUID(), (tx) =>
      tx.query.creditNotes.findFirst({ where: eq(creditNotes.id, creditId) }),
    );
    expect(credit).toMatchObject({
      status: "issued",
      stripeCreditNoteId: providerId,
      orderId: null,
    });
  });
  it("uses local receipt time to block a backdated late correction", async () => {
    const late: PaygMeasurement = {
      ...event,
      sourceMeasurementId: randomUUID(),
      kind: "correction",
      correctsSourceMeasurementId: event.sourceMeasurementId,
      quantity: "-1",
      recordedAt: event.recordedAt,
    };
    await repository.ingestVerifiedReceipt({
      ...receipt,
      receiptId: randomUUID(),
      now: "2026-11-01T00:00:00.000Z",
      measurements: [late],
    });
    expect((await close(now)).replay).toBe(true);
    await expect(close("2026-11-01T00:00:00.000Z")).rejects.toThrow(
      "PAYG_CORRECTION_WINDOW_EXCEEDED",
    );
    const rows = await withInternalTransaction(db, randomUUID(), (tx) =>
      tx
        .select()
        .from(paygPeriodRevisions)
        .where(eq(paygPeriodRevisions.enrollmentId, enrollmentId)),
    );
    expect(rows).toHaveLength(3);
  });
});
