import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SessionClaims } from "@clockwork/api";
import { MoneySchema } from "@clockwork/contracts";
import {
  createMemoryDemoStore,
  resetDemoExperience,
} from "@clockwork/testing/demo-reset";
import {
  DEMO_PRODUCTION_ENVIRONMENT_KEYS,
  FileDemoAdapterStateStore,
} from "@clockwork/testing/demo-state";
import { demoAccountIds } from "@clockwork/testing/personas";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  billingAccountsByOrder,
  collectionCaseFromProjection,
} from "@/src/features/internal-ops/finance-lifecycle/collections-projection";
import { reportExportFromProjection } from "@/src/features/internal-ops/finance-lifecycle/reports-projection";

import { demoUuid } from "./demo-artifact-catalog";
import {
  configuredProjectionSource,
  ExplicitDemoProjectionSource,
  refreshDemoQueueProjections,
} from "./projection-source";
import type { DemoCreatedQuote } from "./demo-quote-flow";
import type { ProjectionRecord } from "./model";

const temporaryDirectories: string[] = [];
const session = {} as SessionClaims;
/**
 * The direct buyer's account. Customer projections are scoped to
 * `audience_account_id` exactly as the persisted read is, so a customer read
 * names the account it is acting for; `null` is the internal audience's scope
 * and matches no tenant record.
 */
const accountId = "11000000-0000-4000-8000-000000000001";

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("explicit demo projection durable reset", () => {
  it.each(DEMO_PRODUCTION_ENVIRONMENT_KEYS)(
    "fails closed when %s identifies production",
    (productionMarker) => {
      vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
      for (const key of DEMO_PRODUCTION_ENVIRONMENT_KEYS)
        vi.stubEnv(key, key === "NODE_ENV" ? "test" : "");
      vi.stubEnv(productionMarker, " Production ");

      expect(() => configuredProjectionSource()).toThrow(
        `${productionMarker} identifies production`,
      );
      try {
        configuredProjectionSource();
      } catch (error) {
        expect(error).toMatchObject({
          status: 503,
          code: "DEMO_ADAPTER_FORBIDDEN",
        });
      }
    },
  );

  it("makes a mutation browser-visible across source instances and restores pristine data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "clockwork-web-demo-"));
    temporaryDirectories.push(directory);
    const store = new FileDemoAdapterStateStore(join(directory, "state.json"));
    const source = new ExplicitDemoProjectionSource(store);
    const initial = await source.find({
      session,
      audience: "customer",
      channel: "quotes",
      accountId,
      recordKey: "Q-2026-0184-v3",
      now: new Date("2026-07-31T16:00:00Z"),
    });
    // The same reference read for another account is absent, not readable.
    await expect(
      source.find({
        session,
        audience: "customer",
        channel: "quotes",
        accountId: "11000000-0000-4000-8000-000000000005",
        recordKey: "Q-2026-0184-v3",
        now: new Date("2026-07-31T16:00:00Z"),
      }),
    ).rejects.toMatchObject({ status: 404, code: "PROJECTION_NOT_FOUND" });

    const receipt = await source.action({
      session,
      projectionId: initial.id,
      recordKey: initial.recordKey,
      audience: initial.audience,
      channel: initial.channel,
      accountId,
      action: "accept",
      expectedVersion: initial.version,
      idempotencyKey: "demo-action-idempotency-1",
      payload: {},
      requestId: "demo-action-request-1",
    });

    const independentSource = new ExplicitDemoProjectionSource(
      new FileDemoAdapterStateStore(store.location),
    );
    const dirty = await independentSource.find({
      session,
      audience: "customer",
      channel: "quotes",
      accountId,
      recordKey: initial.recordKey,
      now: new Date("2026-08-01T12:00:00Z"),
    });
    expect(dirty).toMatchObject({
      version: initial.version + 1,
      data: {
        status: "accepted",
        statusLabel: "Accepted",
        nextAction: "Continue through the recorded order acceptance",
        allowedActions: [],
      },
    });
    expect(receipt).toMatchObject({
      status: "applied",
      authoritativeVersion: initial.version + 1,
      commandReplayed: false,
    });
    expect(typeof receipt.completedAt).toBe("string");
    await expect(
      independentSource.receipt({
        session,
        audience: "customer",
        channel: "quotes",
        accountId,
        recordKey: initial.recordKey,
        actionRequestId: receipt.id,
        requestId: "demo-receipt-request-1",
      }),
    ).resolves.toEqual(receipt);
    await expect(
      independentSource.receipt({
        session,
        audience: "customer",
        channel: "quotes",
        accountId,
        recordKey: "Q-2026-0171-v1",
        actionRequestId: receipt.id,
        requestId: "demo-receipt-wrong-record-request",
      }),
    ).rejects.toMatchObject({ code: "PROJECTION_ACTION_NOT_FOUND" });

    await resetDemoExperience(store, {
      environment: { NODE_ENV: "test", CLOCKWORK_ENV: "demo" },
      target: "demo",
    });

    const resetSource = new ExplicitDemoProjectionSource(
      new FileDemoAdapterStateStore(store.location),
    );
    await expect(
      resetSource.find({
        session,
        audience: "customer",
        channel: "quotes",
        accountId,
        recordKey: initial.recordKey,
        now: new Date("2026-07-31T16:00:00Z"),
      }),
    ).resolves.toEqual(initial);
    await expect(
      resetSource.receipt({
        session,
        audience: "customer",
        channel: "quotes",
        accountId,
        recordKey: initial.recordKey,
        actionRequestId: receipt.id,
        requestId: "demo-receipt-request-2",
      }),
    ).rejects.toMatchObject({ code: "PROJECTION_ACTION_NOT_FOUND" });
  });

  it("keeps ordinary seeded records fresh while preserving refreshable stale queues", async () => {
    const source = new ExplicitDemoProjectionSource(createMemoryDemoStore());
    const now = new Date("2026-08-18T12:00:00.000Z");
    const list = (
      audience: "customer" | "partner" | "internal",
      channel: "quotes" | "dashboard" | "queues",
      scopedAccountId: string | null,
    ) =>
      source.list({
        session,
        audience,
        channel,
        accountId: scopedAccountId,
        limit: 100,
        now,
      });

    const [customer, partner, internal, queues] = await Promise.all([
      list("customer", "quotes", demoAccountIds.direct),
      list("partner", "quotes", demoAccountIds.reseller),
      list("internal", "dashboard", null),
      list("internal", "queues", null),
    ]);
    for (const page of [customer, partner, internal]) {
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.items.every((record) => !record.stale)).toBe(true);
      expect(
        page.items.every(
          (record) => record.sourceUpdatedAt === now.toISOString(),
        ),
      ).toBe(true);
    }
    expect(queues.items.length).toBeGreaterThan(0);
    expect(queues.items.every((record) => record.stale)).toBe(true);
  });

  it("projects a created direct quote with stable commercial and domain identity", async () => {
    const store = createMemoryDemoStore();
    const quoteId = "70000000-0000-4000-8000-000000000091";
    const money = (minor: string) =>
      MoneySchema.parse({ currency: "USD", minor });
    const created: DemoCreatedQuote = {
      snapshot: {
        id: quoteId,
        seriesId: "70000000-0000-4000-8000-000000000092",
        revision: 2,
        accountId: demoAccountIds.direct,
        priceBook: {
          id: "70000000-0000-4000-8000-000000000093",
          version: 3,
        },
        route: "direct",
        status: "issued",
        lines: [
          {
            id: "70000000-0000-4000-8000-000000000094",
            rateCardId: "70000000-0000-4000-8000-000000000095",
            sku: "FIL-STORAGE-COMMITTED",
            region: "us-east-1",
            unit: "TB-month",
            approvedClaim: "Committed encrypted archive capacity",
            quantity: "100",
            termMonths: 12,
            unitPrice: money("1000"),
            listUnitPrice: money("1100"),
            floorPrice: money("900"),
            overageRate: money("1200"),
            lineTotal: money("1200000"),
            discountBps: 909,
            commitType: "period_allowance",
            stripeTaxCode: "txcd_10000000",
            qboIncomeAccount: "Storage revenue",
            marginResult: "pass",
          },
        ],
        total: money("1200000"),
        marginResult: "pass",
        exceptionReasons: [],
        expiresAt: "2026-09-18T12:00:00.000Z",
        createdBy: "20000000-0000-4000-8000-000000000001",
        createdAt: "2026-08-18T11:58:00.000Z",
        issuedAt: "2026-08-18T11:59:00.000Z",
      },
      rowVersion: 3,
      displayNumber: "Q-2026-0441",
      locale: "en-US",
      paymentTermsDays: 30,
      buyerDomain: "meridian-archive.test",
      agreementId: "70000000-0000-4000-8000-000000000096",
      agreementVersion: 3,
      agreementEffectiveOn: "2025-10-01",
      updatedAt: "2026-08-18T11:59:00.000Z",
    };
    await store.update((state) => ({
      ...state,
      createdQuotes: { [quoteId]: created },
    }));
    const source = new ExplicitDemoProjectionSource(store);

    await expect(
      source.find({
        session,
        audience: "customer",
        channel: "quotes",
        accountId: demoAccountIds.direct,
        recordKey: `quote-${quoteId}`,
        now: new Date("2026-08-18T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      recordKey: `quote-${quoteId}`,
      aggregateType: "quote",
      aggregateId: quoteId,
      accountId: demoAccountIds.direct,
      version: 3,
      stale: false,
      data: {
        reference: "Q-2026-0441",
        status: "open",
        totalMinor: "1200000",
        currency: "USD",
        marginResult: "pass",
        agreementId: created.agreementId,
        paymentTermsDays: 30,
        authoritative: {
          status: "issued",
          revision: 2,
          accountId: demoAccountIds.direct,
        },
      },
    });
  });

  it("projects resettable member invites and the current procurement profile", async () => {
    const store = createMemoryDemoStore();
    const createdAt = "2026-08-18T12:00:00.000Z";
    await store.update((state) => ({
      ...state,
      projectionOverrides: {
        ...state.projectionOverrides,
        "demo-account-control:invite:invite-001": {
          version: 1,
          updatedAt: createdAt,
          data: {
            kind: "member_invite",
            id: "72000000-0000-4000-8000-000000000001",
            organizationId: "72000000-0000-4000-8000-000000000002",
            accountId,
            email: "new.member@northstar.example",
            role: "member",
            status: "pending",
            expiresAt: "2026-09-30T17:00:00.000Z",
            createdAt,
          },
        },
        [`demo-account-control:procurement:${accountId}`]: {
          version: 2,
          updatedAt: createdAt,
          data: {
            kind: "procurement_profile",
            accountId,
            apContact: {
              name: "Mara Voss",
              email: "ap@northstar.example",
            },
            invoiceDeliveryEmail: "invoices@northstar.example",
            poRequired: true,
            rowVersion: 2,
            updatedAt: createdAt,
          },
        },
      },
    }));
    const source = new ExplicitDemoProjectionSource(store);
    const list = (channel: "users" | "procurement") =>
      source.list({
        session,
        audience: "customer",
        channel,
        accountId,
        limit: 100,
        now: new Date(createdAt),
      });
    const [users, procurement] = await Promise.all([
      list("users"),
      list("procurement"),
    ]);
    const invite = users.items.find(
      (record) =>
        record.recordKey === "invite-72000000-0000-4000-8000-000000000001",
    );
    expect(invite?.data).toMatchObject({ status: "pending", value: "member" });
    const profiles = procurement.items.filter(
      (record) => record.recordKey === "PROC-AP",
    );
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.version).toBe(2);
    expect(profiles[0]?.data.value).toBe("invoices@northstar.example");

    await resetDemoExperience(store, {
      environment: { NODE_ENV: "test", CLOCKWORK_ENV: "demo" },
      target: "demo",
    });
    const [resetUsers, resetProcurement] = await Promise.all([
      list("users"),
      list("procurement"),
    ]);
    expect(
      resetUsers.items.some((record) => record.recordKey.startsWith("invite-")),
    ).toBe(false);
    expect(
      resetProcurement.items.find((record) => record.recordKey === "PROC-AP")
        ?.data.value,
    ).toBe("ap@northstar.example");
  });

  it("projects a completed sandbox payment as a paid invoice and resets it", async () => {
    const store = createMemoryDemoStore();
    const sessionId = "73000000-0000-4000-8000-000000000001";
    const receiptId = "73000000-0000-4000-8000-000000000002";
    const paymentAttemptId = "73000000-0000-4000-8000-000000000003";
    const completedAt = "2026-08-18T12:15:00.000Z";
    await store.update((state) => ({
      ...state,
      projectionOverrides: {
        ...state.projectionOverrides,
        [`demo-invoice-payment:session:${sessionId}`]: {
          version: 1,
          updatedAt: completedAt,
          data: {
            kind: "demo_invoice_payment",
            sessionId,
            invoiceId: demoUuid("subject:invoice:INV-MER-0042"),
            recordKey: "invoice-meridian-overdue",
            accountId,
            actorId: "73000000-0000-4000-8000-000000000004",
            status: "paid",
            createdAt: "2026-08-18T12:14:00.000Z",
            completedAt,
            paymentAttemptId,
            receiptId,
          },
        },
      },
    }));
    const source = new ExplicitDemoProjectionSource(store);
    const read = () =>
      source.find({
        session,
        audience: "customer",
        channel: "billing",
        accountId,
        recordKey: "invoice-meridian-overdue",
        now: new Date(completedAt),
      });
    const paid = await read();
    expect(paid).toMatchObject({
      version: 2,
      sourceUpdatedAt: completedAt,
      data: {
        status: "paid",
        statusLabel: "Paid · demo sandbox",
        tone: "success",
        risk: "low",
        value: "$17,132.50",
        description: `Demo receipt ${receiptId} · sandbox only · no money moved`,
        title: "Committed capacity · paid",
        dateLabel: "Demo payment confirmed 2026-08-18 UTC",
        nextAction: "Payment complete · no further payment is due",
        allowedActions: [],
        authoritative: {
          status: "paid",
          provider: "demo_sandbox",
          paymentAttemptId,
          receiptId,
          completedAt,
        },
      },
    });

    await resetDemoExperience(store, {
      environment: { NODE_ENV: "test", CLOCKWORK_ENV: "demo" },
      target: "demo",
    });
    await expect(read()).resolves.toMatchObject({
      version: 1,
      data: {
        status: "open",
        statusLabel: "Overdue · payment retry available",
      },
    });
  });

  it("projects production-shaped finance identities and facts", async () => {
    const source = new ExplicitDemoProjectionSource(createMemoryDemoStore());
    const now = new Date("2026-08-18T12:00:00.000Z");
    const read = (
      channel: "dashboard" | "orders" | "collections" | "reports",
    ) =>
      source.list({
        session,
        audience: "internal",
        channel,
        accountId: null,
        limit: 100,
        now,
      });

    const [accounts, orders, invoices, reports] = await Promise.all([
      read("dashboard"),
      read("orders"),
      read("collections"),
      read("reports"),
    ]);

    expect(accounts.items.map((record) => record.aggregateId)).toEqual(
      expect.arrayContaining([
        "11000000-0000-4000-8000-000000000001",
        "11000000-0000-4000-8000-000000000003",
        "11000000-0000-4000-8000-000000000007",
      ]),
    );
    const order = orders.items.find(
      (record) => record.recordKey === "ORD-2026-0098",
    );
    const invoice = invoices.items.find(
      (record) => record.recordKey === "INV-2026-0781",
    );
    const report = reports.items.find(
      (record) => record.recordKey === "RPT-2026-07",
    );
    if (!order || !invoice || !report)
      throw new Error("The internal finance demo fixture is incomplete");
    expect(order).toMatchObject({
      aggregateType: "order",
      data: {
        authoritative: {
          invoicingAccountId: accountId,
          sourcing: "direct",
          serviceEndsOn: "2026-12-31",
        },
      },
    });
    expect(invoice).toMatchObject({
      aggregateType: "invoice",
      data: {
        authoritative: {
          orderId: order.aggregateId,
          currency: "USD",
          status: "open",
        },
      },
    });
    const invoiceAuthoritative = invoice.data.authoritative as Readonly<
      Record<string, unknown>
    >;
    expect(invoiceAuthoritative.amountMinor).toEqual(
      expect.stringMatching(/^\d+$/u),
    );
    expect(invoice.aggregateId).not.toBe(invoice.id);

    const collection = collectionCaseFromProjection(
      invoice,
      billingAccountsByOrder(orders.items),
      now,
    );
    expect(collection).toMatchObject({
      billingAccountId: accountId,
      currency: "USD",
      overdue: true,
    });
    expect(typeof collection.amountMinor).toBe("bigint");

    expect(report).toMatchObject({
      aggregateType: "report_export",
      data: {
        authoritative: {
          report: "renewal_churn_exposure",
          status: "complete",
        },
        artifacts: [
          expect.objectContaining({ kind: "report_export", state: "stored" }),
        ],
      },
    });
    const reportAuthoritative = report.data.authoritative as Readonly<
      Record<string, unknown>
    >;
    expect(reportAuthoritative.documentId).toEqual(
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u,
      ),
    );
    expect(reportExportFromProjection(report)).toMatchObject({
      report: "renewal_churn_exposure",
      status: "complete",
    });
  });

  it("applies customer, partner, and internal demo actions with durable replay", async () => {
    const source = new ExplicitDemoProjectionSource(createMemoryDemoStore());
    const now = new Date("2026-08-18T12:00:00.000Z");
    const find = (
      audience: "customer" | "partner" | "internal",
      channel: "quotes" | "queues" | "provisioning" | "approvals",
      scopedAccountId: string | null,
      recordKey: string,
    ) =>
      source.find({
        session,
        audience,
        channel,
        accountId: scopedAccountId,
        recordKey,
        now,
      });

    const customer = await find(
      "customer",
      "quotes",
      accountId,
      "Q-2026-0184-v3",
    );
    const customerInput = {
      session,
      projectionId: customer.id,
      recordKey: customer.recordKey,
      audience: customer.audience,
      channel: customer.channel,
      accountId,
      action: "expire",
      expectedVersion: customer.version,
      idempotencyKey: "customer-expire-0001",
      payload: {},
      requestId: "customer-expire-request-0001",
    } as const;
    const [customerApplied, customerReplay] = await Promise.all([
      source.action(customerInput),
      source.action(customerInput),
    ]);
    expect(customerApplied.id).toBe(customerReplay.id);
    expect([
      customerApplied.commandReplayed,
      customerReplay.commandReplayed,
    ]).toEqual(expect.arrayContaining([false, true]));
    await expect(
      find("customer", "quotes", accountId, customer.recordKey),
    ).resolves.toMatchObject({
      version: customer.version + 1,
      data: { status: "expired", statusLabel: "Expired", allowedActions: [] },
    });
    await expect(
      source.action({ ...customerInput, action: "accept" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const partnerAccountId = "11000000-0000-4000-8000-000000000003";
    const partner = await find(
      "partner",
      "quotes",
      partnerAccountId,
      "PQ-2026-0184-v3",
    );
    expect(partner.data.allowedActions).toEqual(["prepare_artifact"]);
    await expect(
      source.action({
        session,
        projectionId: partner.id,
        recordKey: partner.recordKey,
        audience: partner.audience,
        channel: partner.channel,
        accountId: partnerAccountId,
        action: "prepare_artifact",
        expectedVersion: partner.version,
        idempotencyKey: "partner-artifact-0001",
        payload: {},
        requestId: "partner-artifact-request-0001",
      }),
    ).resolves.toMatchObject({ status: "applied", authoritativeVersion: 2 });
    await expect(
      find("partner", "quotes", partnerAccountId, partner.recordKey),
    ).resolves.toMatchObject({
      data: { status: "ready", statusLabel: "Document prepared" },
    });

    const internal = await find(
      "internal",
      "queues",
      null,
      "queue-legal-meridian",
    );
    await expect(
      source.action({
        session,
        projectionId: internal.id,
        recordKey: internal.recordKey,
        audience: internal.audience,
        channel: internal.channel,
        accountId: null,
        action: "review_exception",
        expectedVersion: internal.version,
        idempotencyKey: "internal-review-0001",
        payload: {},
        requestId: "internal-review-request-0001",
      }),
    ).resolves.toMatchObject({ status: "applied", authoritativeVersion: 2 });
    await expect(
      find("internal", "queues", null, internal.recordKey),
    ).resolves.toMatchObject({
      data: { status: "complete", statusLabel: "Review recorded" },
    });

    const provisioning = await find(
      "internal",
      "provisioning",
      null,
      "PRV-DEMO-001",
    );
    await expect(
      source.action({
        session,
        projectionId: provisioning.id,
        recordKey: provisioning.recordKey,
        audience: provisioning.audience,
        channel: provisioning.channel,
        accountId: null,
        action: "replay_provider_event",
        expectedVersion: provisioning.version,
        idempotencyKey: "provisioning-replay-0001",
        payload: {},
        requestId: "provisioning-replay-request-0001",
      }),
    ).resolves.toMatchObject({ status: "applied", authoritativeVersion: 2 });
    await expect(
      find("internal", "provisioning", null, provisioning.recordKey),
    ).resolves.toMatchObject({
      data: {
        status: "recovering",
        statusLabel: "Provider replay recorded",
        nextAction: "Monitor provisioning completion",
        allowedActions: [],
        authoritative: { status: "recovering" },
      },
    });

    const approval = await find("internal", "approvals", null, "APR-DEMO-001");
    await expect(
      source.action({
        session,
        projectionId: approval.id,
        recordKey: approval.recordKey,
        audience: approval.audience,
        channel: approval.channel,
        accountId: null,
        action: "approve_exception",
        expectedVersion: approval.version,
        idempotencyKey: "approval-decision-0001",
        payload: {},
        requestId: "approval-decision-request-0001",
      }),
    ).resolves.toMatchObject({ status: "applied", authoritativeVersion: 2 });
    await expect(
      find("internal", "approvals", null, approval.recordKey),
    ).resolves.toMatchObject({
      data: {
        status: "approved",
        statusLabel: "Approved",
        allowedActions: [],
        authoritative: { status: "approved" },
      },
    });
  });

  it("persists the guided customer agreement, POC, renewal, and offboarding lifecycle", async () => {
    const source = new ExplicitDemoProjectionSource(createMemoryDemoStore());
    const now = new Date("2026-08-18T12:00:00.000Z");
    const page = (channel: "agreements" | "pocs" | "orders") =>
      source.list({
        session,
        audience: "customer",
        channel,
        accountId,
        limit: 100,
        now,
      });
    const [agreements, pocs, orders] = await Promise.all([
      page("agreements"),
      page("pocs"),
      page("orders"),
    ]);
    const withAction = (records: readonly ProjectionRecord[], action: string) =>
      records.find(
        (record) =>
          Array.isArray(record.data.allowedActions) &&
          record.data.allowedActions.includes(action),
      );
    const agreement = withAction(agreements.items, "execute_agreement");
    const poc = withAction(pocs.items, "convert_poc");
    const renewal = withAction(orders.items, "request_renewal");
    if (!agreement || !poc || !renewal)
      throw new Error("The guided customer lifecycle fixtures are incomplete");

    for (const [record, action] of [
      [agreement, "execute_agreement"],
      [poc, "convert_poc"],
      [renewal, "request_renewal"],
    ] as const) {
      await source.action({
        session,
        projectionId: record.id,
        recordKey: record.recordKey,
        audience: "customer",
        channel: record.channel,
        accountId,
        action,
        expectedVersion: record.version,
        idempotencyKey: `customer-lifecycle-${action}`,
        payload: {},
        requestId: `customer-lifecycle-${action}-request`,
      });
    }

    // Renewal and offboarding are mutually exclusive decisions on one active
    // order. Exercise offboarding from an independent pristine demo state.
    const offboardingSource = new ExplicitDemoProjectionSource(
      createMemoryDemoStore(),
    );
    const offboarding = renewal;
    await offboardingSource.action({
      session,
      projectionId: offboarding.id,
      recordKey: offboarding.recordKey,
      audience: "customer",
      channel: "orders",
      accountId,
      action: "request_teardown",
      expectedVersion: offboarding.version,
      idempotencyKey: "customer-lifecycle-request_teardown",
      payload: {},
      requestId: "customer-lifecycle-request_teardown-request",
    });

    const executed = (await page("agreements")).items.find(
      (record) => record.recordKey === agreement.recordKey,
    );
    const converted = (await page("pocs")).items.find(
      (record) => record.recordKey === poc.recordKey,
    );
    const renewed = (await page("orders")).items.find(
      (record) => record.recordKey === renewal.recordKey,
    );
    expect(executed?.data.statusLabel).toBe("Executed");
    expect(converted?.data.statusLabel).toBe("Converted to paid quote");
    expect(renewed?.data.statusLabel).toBe("Renewal requested");
    await expect(
      offboardingSource.find({
        session,
        audience: "customer",
        channel: "orders",
        accountId,
        recordKey: offboarding.recordKey,
        now,
      }),
    ).resolves.toMatchObject({
      data: { statusLabel: "Offboarding requested" },
    });
  });

  it("refreshes queue freshness atomically with scoped replay and reset", async () => {
    const store = createMemoryDemoStore();
    const source = new ExplicitDemoProjectionSource(store);
    const list = (now: Date) =>
      source.list({
        session,
        audience: "internal",
        channel: "queues",
        accountId: null,
        limit: 100,
        now,
      });
    const initial = await list(new Date("2026-08-18T12:00:00.000Z"));
    expect(initial.items.length).toBeGreaterThan(0);
    expect(initial.items.every((record) => record.stale)).toBe(true);

    const request = {
      actorId: "20000000-0000-4000-8000-000000000001",
      idempotencyKey: "queue-refresh-idempotency-0001",
      requestDigest: "a".repeat(64),
      stateStore: store,
    } as const;
    const [first, replay] = await Promise.all([
      refreshDemoQueueProjections({
        ...request,
        now: new Date("2026-08-18T12:01:00.000Z"),
      }),
      refreshDemoQueueProjections({
        ...request,
        now: new Date("2026-08-18T12:02:00.000Z"),
      }),
    ]);
    expect(first.refreshedAt).toBe(replay.refreshedAt);
    expect([first.replayed, replay.replayed]).toEqual(
      expect.arrayContaining([false, true]),
    );
    expect(first.refreshedRecords).toBe(initial.items.length);

    const refreshed = await list(new Date(first.refreshedAt));
    expect(refreshed.items.every((record) => !record.stale)).toBe(true);
    expect(
      refreshed.items.every(
        (record) =>
          record.sourceUpdatedAt === first.refreshedAt && record.version === 2,
      ),
    ).toBe(true);
    expect(JSON.stringify(await store.read())).not.toContain(
      request.idempotencyKey,
    );

    await expect(
      refreshDemoQueueProjections({
        ...request,
        requestDigest: "b".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      refreshDemoQueueProjections({
        ...request,
        idempotencyKey: "queue-refresh-idempotency-0002",
        now: new Date("2026-08-18T12:03:00.000Z"),
      }),
    ).resolves.toMatchObject({ replayed: false });
    const refreshedAgain = await list(new Date("2026-08-18T12:03:00.000Z"));
    expect(refreshedAgain.items.every((record) => record.version === 3)).toBe(
      true,
    );

    await resetDemoExperience(store, {
      environment: { NODE_ENV: "test", CLOCKWORK_ENV: "demo" },
      target: "demo",
    });
    const afterReset = await refreshDemoQueueProjections({
      ...request,
      now: new Date("2026-08-18T12:04:00.000Z"),
    });
    expect(afterReset).toMatchObject({ replayed: false });
    const resetThenRefreshed = await list(new Date("2026-08-18T12:04:00.000Z"));
    expect(
      resetThenRefreshed.items.every((record) => record.version === 2),
    ).toBe(true);
  });
});
