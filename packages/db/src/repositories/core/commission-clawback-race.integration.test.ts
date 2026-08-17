import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";

import { createRuntimeDatabase } from "../../client";
import {
  DatabaseCoreError,
  DatabaseCoreFinanceRepository,
} from "./database-finance";
import { FixtureTaxPort } from "./tax-fixture";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";
const internalUserId = "20000000-0000-4000-8000-000000000001";
const referralPartnerId = "10000000-0000-4000-8000-000000000002";
const referralCustomerId = "10000000-0000-4000-8000-000000000004";
const referralOrderId = "80000000-0000-4000-8000-000000000002";
const barrierKey = 1_419_001;

const authorization: AuthorizationContext = {
  userId: ids.user.parse(internalUserId),
  accountIds: [ids.account.parse(referralPartnerId)],
  roles: ["internal_operator"],
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

async function waitForAdvisoryWaiters(
  observer: postgres.Sql,
  expected: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [row] = await observer<{ waiter_count: number }[]>`
      select count(*)::int as waiter_count
      from pg_stat_activity
      where datname = current_database()
        and wait_event_type = 'Lock'
        and wait_event = 'advisory'
    `;
    if ((row?.waiter_count ?? 0) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${expected} advisory-lock waiters`);
}

describe("commission clawback concurrency", () => {
  it("serializes reversals at the original accrual and maps the losing write", async () => {
    const suffix = randomUUID();
    const invoiceId = randomUUID();
    const paymentId = randomUUID();
    const accrualId = randomUUID();
    const refundId = randomUUID();
    const disputeId = randomUUID();
    const firstMutationId = randomUUID();
    const secondMutationId = randomUUID();
    const firstRuntime = createRuntimeDatabase({
      url: databaseUrl,
      maxConnections: 1,
      role: "clockwork_service",
      ssl: false,
    });
    const secondRuntime = createRuntimeDatabase({
      url: databaseUrl,
      maxConnections: 1,
      role: "clockwork_service",
      ssl: false,
    });
    const observer = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      ssl: false,
    });
    const firstRepository = new DatabaseCoreFinanceRepository({
      database: firstRuntime.db,
      pricingDatabase: firstRuntime.db,
      authorizationSecret,
      tax: new FixtureTaxPort(),
    });
    const secondRepository = new DatabaseCoreFinanceRepository({
      database: secondRuntime.db,
      pricingDatabase: secondRuntime.db,
      authorizationSecret,
      tax: new FixtureTaxPort(),
    });

    let barrierHeld = false;
    try {
      await observer.begin(async (sql) => {
        await sql`
          insert into invoices (
            id, order_id, account_id, stripe_invoice_id, currency,
            amount_minor, tax_minor, tax_treatment, po_number, status
          ) values (
            ${invoiceId}, ${referralOrderId}, ${referralCustomerId},
            ${`in_clawback_race_${suffix}`}, 'USD', 120000, 0, 'standard',
            'PO-REF-002', 'open'
          )
        `;
        await sql`
          insert into payments (
            id, invoice_id, order_id, stripe_payment_intent_id, currency,
            amount_minor, status, received_at
          ) values (
            ${paymentId}, ${invoiceId}, ${referralOrderId},
            ${`pi_clawback_race_${suffix}`}, 'USD', 120000, 'succeeded',
            '2099-08-01T16:00:00Z'
          )
        `;
        await sql`
          insert into commission_accruals (
            id, partner_account_id, invoice_id, source_type, source_id,
            rate_bps, holdback_bps, currency, net_collected_revenue_minor,
            amount_minor, holdback_minor, period, status
          ) values (
            ${accrualId}, ${referralPartnerId}, ${invoiceId}, 'payment',
            ${paymentId}, 1200, 1000, 'USD', 120000, 14400, 1440,
            '2099-Q3', 'accrued'
          )
        `;
        await sql`
          insert into refunds (
            id, payment_id, order_id, stripe_refund_id, currency,
            amount_minor, reason_code, status, created_at
          ) values (
            ${refundId}, ${paymentId}, ${referralOrderId},
            ${`re_clawback_race_${suffix}`}, 'USD', 72000,
            'customer_request', 'succeeded', '2099-08-02T16:00:00Z'
          )
        `;
        await sql`
          insert into dispute_cases (
            id, payment_id, order_id, stripe_dispute_id, currency,
            amount_minor, evidence_due_at, status, created_at, updated_at
          ) values (
            ${disputeId}, ${paymentId}, ${referralOrderId},
            ${`dp_clawback_race_${suffix}`}, 'USD', 72000,
            '2099-08-03T16:00:00Z', 'lost',
            '2099-08-03T16:00:00Z', '2099-08-03T16:00:00Z'
          )
        `;
      });
      await observer.unsafe(`
        create or replace function public.test_commission_clawback_race_barrier()
        returns trigger
        language plpgsql
        as $function$
        begin
          if new.invoice_id = '${invoiceId}'::uuid then
            perform pg_advisory_xact_lock(${barrierKey});
          end if;
          return new;
        end;
        $function$;
        drop trigger if exists commission_accruals_000_race_barrier
          on public.commission_accruals;
        create trigger commission_accruals_000_race_barrier
          before insert on public.commission_accruals
          for each row execute function public.test_commission_clawback_race_barrier();
      `);
      await observer`select pg_advisory_lock(${barrierKey})`;
      barrierHeld = true;

      const mutate = (
        repository: DatabaseCoreFinanceRepository,
        input: {
          id: string;
          sourceType: "refund" | "chargeback";
          sourceId: string;
        },
      ) =>
        repository.mutate({
          resource: "commissions",
          id: input.id,
          accountId: referralPartnerId,
          action: "clawback",
          payload: {
            sourceType: input.sourceType,
            sourceId: input.sourceId,
          },
          actor: { kind: "user", id: authorization.userId },
          authorization,
          requestId: `commission-clawback-race-${input.id}`,
          idempotencyKey: `commission-clawback-race-${input.id}`,
          occurredAt: "2099-08-03T16:00:00Z",
        });

      const first = mutate(firstRepository, {
        id: firstMutationId,
        sourceType: "refund",
        sourceId: refundId,
      }).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      );
      const second = mutate(secondRepository, {
        id: secondMutationId,
        sourceType: "chargeback",
        sourceId: disputeId,
      }).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      );

      await waitForAdvisoryWaiters(observer, 2);
      await observer`select pg_advisory_unlock(${barrierKey})`;
      barrierHeld = false;

      const results = await Promise.all([first, second]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const refusal = results.find((result) => result.status === "rejected");
      expect(refusal?.status).toBe("rejected");
      if (refusal?.status !== "rejected") throw new Error("Expected a refusal");
      expect(refusal.error).toBeInstanceOf(DatabaseCoreError);
      expect(refusal.error).toMatchObject({
        code: "INVALID_STATE",
        message:
          "Commission clawbacks cannot exceed persisted collected revenue",
      });

      const [persisted] = await observer<{ reversed_minor: string }[]>`
        select coalesce(-sum(net_collected_revenue_minor), 0)::text as reversed_minor
        from commission_accruals
        where adjustment_source_id = ${accrualId}
          and source_type in ('credit_note', 'refund', 'dispute')
      `;
      expect(persisted?.reversed_minor).toBe("72000");
    } finally {
      if (barrierHeld) await observer`select pg_advisory_unlock(${barrierKey})`;
      await observer.unsafe(`
        drop trigger if exists commission_accruals_000_race_barrier
          on public.commission_accruals;
        drop function if exists public.test_commission_clawback_race_barrier();
      `);
      await Promise.all([
        firstRuntime.client.end(),
        secondRuntime.client.end(),
        observer.end(),
      ]);
    }
  });
});
