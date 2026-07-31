import { afterAll, describe, expect, it } from "vitest";

import { ids, type Role } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";

import { createRuntimeDatabase } from "../../client";
import { DatabaseCoreFinanceRepository } from "./database-finance";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";
const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 2,
  role: "clockwork_service",
  ssl: false,
});
const repository = new DatabaseCoreFinanceRepository({
  database: db,
  pricingDatabase: db,
  authorizationSecret,
});
const finance: AuthorizationContext = {
  userId: ids.user.parse("20000000-0000-4000-8000-000000000001"),
  accountIds: [ids.account.parse("10000000-0000-4000-8000-000000000009")],
  roles: ["finance_approver"],
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};
const runId = crypto.randomUUID().replaceAll("-", "");
const mutation = (input: {
  resource: "invoices" | "credit_notes" | "refunds" | "disputes";
  id: string;
  accountId: string;
  action: string;
  payload: Record<string, unknown>;
  roles?: Role[];
  internal?: boolean;
  idempotencyKey: string;
}) =>
  repository.mutate({
    resource: input.resource,
    id: input.id,
    accountId: input.accountId,
    action: input.action,
    payload: input.payload,
    actor: { kind: "user", id: finance.userId },
    authorization: {
      ...finance,
      roles: input.roles ?? finance.roles,
      isInternalStaff: input.internal ?? finance.isInternalStaff,
    },
    requestId: `collections-${input.idempotencyKey}`,
    idempotencyKey: `${input.idempotencyKey}-${runId}`,
    occurredAt: "2026-07-31T16:00:00.000Z",
  });

afterAll(async () => client.end());

describe("persisted collections and financial corrections", () => {
  it("persists replay-safe dunning, credit, refund, and dispute joins", async () => {
    const dunning = await mutation({
      resource: "invoices",
      id: "90000000-0000-4000-8000-000000000001",
      accountId: "10000000-0000-4000-8000-000000000001",
      action: "evaluate_dunning",
      payload: {},
      idempotencyKey: "dunning",
    });
    expect(dunning.record.data.collectionCase).toMatchObject({
      status: "escalated",
      runningServiceDecision: "human_review",
      newServiceBlocked: true,
    });

    const creditId = crypto.randomUUID();
    const creditInput = {
      resource: "credit_notes" as const,
      id: creditId,
      accountId: "10000000-0000-4000-8000-000000000004",
      action: "issue",
      payload: {
        invoiceId: "90000000-0000-4000-8000-000000000002",
        stripeCreditNoteId: `cn_${runId}`,
        amount: { currency: "USD", minor: "1000" },
        reasonCode: "service_adjustment",
      },
      idempotencyKey: "credit",
    };
    const credit = await mutation(creditInput);
    await expect(mutation(creditInput)).resolves.toEqual(credit);

    const refund = await mutation({
      resource: "refunds",
      id: crypto.randomUUID(),
      accountId: "10000000-0000-4000-8000-000000000004",
      action: "submit",
      payload: {
        paymentId: "91000000-0000-4000-8000-000000000002",
        stripeRefundId: `re_${runId}`,
        amount: { currency: "USD", minor: "1000" },
        reasonCode: "customer_request",
      },
      idempotencyKey: "refund",
    });
    expect(refund.record.data).toMatchObject({ status: "pending" });

    const dispute = await mutation({
      resource: "disputes",
      id: crypto.randomUUID(),
      accountId: "10000000-0000-4000-8000-000000000004",
      action: "create",
      payload: {
        paymentId: "91000000-0000-4000-8000-000000000002",
        stripeDisputeId: `dp_${runId}`,
        amount: { currency: "USD", minor: "1000" },
        evidenceDueAt: "2026-08-05T16:00:00.000Z",
      },
      idempotencyKey: "dispute",
    });
    expect(dispute.record.data).toMatchObject({ status: "needs_response" });
  });

  it("fails domain authorization before account-scoped RLS can be abused", async () => {
    await expect(
      mutation({
        resource: "credit_notes",
        id: crypto.randomUUID(),
        accountId: "10000000-0000-4000-8000-000000000004",
        action: "issue",
        payload: {},
        roles: ["owner"],
        internal: false,
        idempotencyKey: "unauthorized-credit",
      }),
    ).rejects.toThrow("Finance approval authority is required");
  });
});
