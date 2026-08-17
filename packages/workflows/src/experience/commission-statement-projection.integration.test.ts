import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it, vi } from "vitest";

import { ids } from "@clockwork/contracts";
import {
  createRuntimeDatabase,
  DatabaseCommissionStatementRepository,
  DatabaseCoreFinanceRepository,
  FixtureTaxPort,
} from "@clockwork/db";
import type { AuthorizationContext } from "@clockwork/domain";

import { createCoreWorkflowOutboxHandlersWithStore } from "../core/outbox-handlers";
import { createProductionExperienceOutboxHandlers } from "./production-handlers";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";
const internalUserId = "20000000-0000-4000-8000-000000000001";
const partnerAccountId = "10000000-0000-4000-8000-000000000002";
const referralOrderId = "80000000-0000-4000-8000-000000000002";
const referralInvoiceId = "90000000-0000-4000-8000-000000000002";

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 4,
  role: "clockwork_service",
  ssl: false,
});
const tax = new FixtureTaxPort();
const finance = new DatabaseCoreFinanceRepository({
  database: db,
  pricingDatabase: db,
  authorizationSecret,
  tax,
});
const statements = new DatabaseCommissionStatementRepository(db);
const authorization: AuthorizationContext = {
  userId: ids.user.parse(internalUserId),
  accountIds: [ids.account.parse(partnerAccountId)],
  roles: ["internal_operator"],
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

function uniqueQuarter() {
  const entropy = Number.parseInt(randomUUID().slice(0, 4), 16);
  const year = 3000 + (entropy % 6000);
  const quarter = (entropy % 4) + 1;
  const month = (quarter - 1) * 3;
  return {
    quarter: `${year}-Q${quarter}`,
    occurredAt: new Date(Date.UTC(year, month, 15, 12)).toISOString(),
  };
}

async function outboxDelivery(topic: string, aggregateId: string) {
  const [message] = await client.unsafe<
    {
      id: string;
      event_id: string;
      topic: string;
      payload: unknown;
    }[]
  >(
    `select id, event_id, topic, payload
       from public.outbox_messages
      where topic = $1 and payload->>'aggregateId' = $2
      order by created_at desc
      limit 1`,
    [topic, aggregateId],
  );
  if (!message) throw new Error(`Expected ${topic} outbox delivery`);
  return {
    messageId: message.id,
    eventId: message.event_id,
    topic: message.topic,
    payload: message.payload,
    idempotencyKey: `outbox:${message.id}`,
  };
}

afterAll(async () => {
  await client.end();
});

describe.sequential("production commission statement projection", () => {
  it("materializes a generated statement and refreshes that record on settlement", async () => {
    const paymentId = randomUUID();
    const accrualId = randomUUID();
    const statementId = randomUUID();
    const period = uniqueQuarter();
    await client.unsafe(
      `insert into public.payments (
         id, invoice_id, order_id, stripe_payment_intent_id, currency,
         amount_minor, status, received_at
       ) values ($1::uuid, $2::uuid, $3::uuid, $4, 'USD', 120000,
                 'succeeded', $5::timestamptz)`,
      [
        paymentId,
        referralInvoiceId,
        referralOrderId,
        `pi_commission_projection_${paymentId}`,
        period.occurredAt,
      ],
    );
    await finance.mutate({
      resource: "commissions",
      id: accrualId,
      accountId: partnerAccountId,
      action: "accrue",
      payload: { sourceType: "payment", sourceId: paymentId },
      actor: { kind: "user", id: internalUserId },
      authorization,
      requestId: `commission-projection-accrue:${accrualId}`,
      idempotencyKey: `commission-projection-accrue:${accrualId}`,
      occurredAt: period.occurredAt,
    });
    const generated = await statements.generate({
      statementId,
      partnerAccountId,
      quarter: period.quarter,
      currency: "USD",
      actor: { kind: "user", id: internalUserId },
      requestId: `commission-projection-generate:${statementId}`,
      occurredAt: period.occurredAt,
    });
    expect(generated).toMatchObject({
      statementId,
      grossAccruedMinor: "14400",
      holdbackMinor: "1440",
      payableMinor: "12960",
      lineCount: 1,
    });

    const settle = vi.fn();
    const core = createCoreWorkflowOutboxHandlersWithStore({
      store: {
        ensureInvoiceDraftForProvisionedOrder: vi.fn(),
        buildIssueInvoiceDispatch: vi.fn(),
        buildCommissionSettlementDispatch: settle,
        projectReferralCommission: vi.fn(),
      },
      submit: { submit: vi.fn() },
    });
    const experience = createProductionExperienceOutboxHandlers({
      database: db,
      authorizationSecret,
      tax,
      clock: () => new Date(period.occurredAt),
    });
    expect(core.has("core.commission_statement.generated")).toBe(false);
    expect(experience.has("core.commission_statement.generated")).toBe(true);
    expect(experience.has("core.commission_statement.settled")).toBe(true);

    const generatedHandler = experience.get(
      "core.commission_statement.generated",
    );
    if (!generatedHandler) throw new Error("Generated handler is unavailable");
    await generatedHandler(
      await outboxDelivery("core.commission_statement.generated", statementId),
    );
    expect(settle).not.toHaveBeenCalled();

    const generatedRows = await client.unsafe<
      {
        audience: string;
        audience_account_id: string | null;
        channel: string;
        aggregate_type: string;
        aggregate_id: string;
        record_key: string;
        payload: Record<string, unknown>;
        row_version: number;
      }[]
    >(
      `select audience, audience_account_id, channel, aggregate_type,
              aggregate_id, record_key, payload, row_version
         from public.experience_portal_projections
        where aggregate_type = 'commission_statement'
          and aggregate_id = $1::uuid`,
      [statementId],
    );
    expect(generatedRows).toHaveLength(1);
    expect(generatedRows[0]).toMatchObject({
      audience: "partner",
      audience_account_id: partnerAccountId,
      channel: "commissions",
      aggregate_type: "commission_statement",
      aggregate_id: statementId,
      record_key: `commission_statement-${statementId}`,
      row_version: 1,
      payload: {
        id: statementId,
        status: "draft",
        value: "$144.00",
        valueLabel: "Accrued USD",
        secondary: "Statement Draft",
      },
    });

    const [issued] = await client.unsafe<{ row_version: number }[]>(
      `update public.core_commission_statements
          set status = 'issued'
        where id = $1::uuid and status = 'draft'
        returning row_version`,
      [statementId],
    );
    if (!issued) throw new Error("Statement issuance fixture was not found");
    const [approved] = await client.unsafe<{ row_version: number }[]>(
      `update public.core_commission_statements
          set status = 'approved'
        where id = $1::uuid and status = 'issued' and row_version = $2
        returning row_version`,
      [statementId, issued.row_version],
    );
    if (!approved) throw new Error("Statement approval fixture was not found");
    const exportKey = `commission-projection-export:${statementId}`;
    await statements.validateSettlement({
      statementId,
      partnerAccountId,
      expectedRowVersion: approved.row_version,
      currency: "USD",
      payableMinor: generated.payableMinor,
      accrualIds: [accrualId],
      exportKey,
    });
    await statements.finalizeSettlement({
      statementId,
      partnerAccountId,
      expectedRowVersion: approved.row_version,
      currency: "USD",
      payableMinor: generated.payableMinor,
      accrualIds: [accrualId],
      exportKey,
      providerBillId: `qbo_bill_${statementId}`,
      actor: { kind: "system", id: "commission-settlement-workflow" },
      requestId: `commission-projection-settle:${statementId}`,
      occurredAt: period.occurredAt,
    });
    const settledHandler = experience.get("core.commission_statement.settled");
    if (!settledHandler) throw new Error("Settled handler is unavailable");
    await settledHandler(
      await outboxDelivery("core.commission_statement.settled", statementId),
    );

    const refreshed = await client.unsafe<
      {
        payload: Record<string, unknown>;
        row_version: number;
        source_aggregate_version: number;
      }[]
    >(
      `select payload, row_version, source_aggregate_version
         from public.experience_portal_projections
        where aggregate_type = 'commission_statement'
          and aggregate_id = $1::uuid`,
      [statementId],
    );
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]).toMatchObject({
      row_version: 2,
      source_aggregate_version: approved.row_version + 2,
      payload: {
        id: statementId,
        status: "paid",
        statusLabel: "Paid",
        value: "$144.00",
        secondary: "Statement Paid",
      },
    });
  });
});
