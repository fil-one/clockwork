import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  assistedSessionWithheldPermissions,
  contextPermissions,
  uuidV7,
} from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";

import { createRuntimeDatabase } from "../../client";
import {
  withAuthorizedTransaction,
  withInternalTransaction,
} from "../../transaction";
import { DatabaseAuthoritativePortalCommandExecutor } from "./authoritative-command";
import { DatabaseCoreFinanceRepository } from "../core";
import { FixtureTaxPort } from "../core/tax-fixture";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";
const accountId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000002";
const quoteId = uuidV7();
const seriesId = uuidV7();
const lineId = uuidV7();
const idempotencyKey = `portal-authoritative-${uuidV7()}`;
const now = new Date();

const runtime = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 3,
  role: "clockwork_service",
  ssl: false,
});
const executor = new DatabaseAuthoritativePortalCommandExecutor({
  database: runtime.db,
  authorizationSecret,
  tax: new FixtureTaxPort(),
  now: () => now,
});

const command = {
  commandResource: "core:quotes",
  action: "expire",
  aggregateType: "quote",
  aggregateId: quoteId,
  expectedVersion: 1,
  payload: {},
  actor: { kind: "user", id: userId } as const,
  effectiveAccountId: accountId,
  assistedSessionId: null,
  assistedReason: null,
  mfaVerified: true,
  recentAuthenticationVerified: true,
  authorizationCreatedAt: now.toISOString(),
  idempotencyKey,
  requestId: `portal-authoritative-integration-${quoteId}`,
};

/** An issued, already expired direct quote on the Northstar account. */
async function seedQuote(seed: {
  quote: string;
  series: string;
  line: string;
}) {
  const createdAt = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const expiresAt = new Date(now.getTime() - 5 * 60_000).toISOString();
  await withInternalTransaction(
    runtime.db,
    `seed:${seed.quote}`,
    async (tx) => {
      await tx.execute(sql`
      insert into public.quotes (
        id, account_id, price_book_id, series_id, revision, status, currency,
        total_minor, margin_floor_result, expires_at, created_by,
        rendered_document_id, created_at, updated_at, row_version, immutable_at
      ) values (
        ${seed.quote}::uuid, ${accountId}::uuid,
        '60000000-0000-4000-8000-000000000001'::uuid,
        ${seed.series}::uuid, 1, 'issued', 'USD', 180000, 'pass',
        ${expiresAt}::timestamptz, ${userId}::uuid,
        '40000000-0000-4000-8000-000000000003'::uuid,
        ${createdAt}::timestamptz, ${createdAt}::timestamptz, 1,
        ${createdAt}::timestamptz
      )
    `);
      await tx.execute(sql`
      insert into public.core_quote_commercial_profiles (
        quote_id, channel_shape, merchant_of_record, pricing_authority,
        billing_account_id, white_label_metadata, pricing_inputs,
        pricing_calculated_at
      ) values (
        ${seed.quote}::uuid, 'direct', 'fil_one', 'fil_one', ${accountId}::uuid,
        '{}'::jsonb, '{"exceptionReasons":[]}'::jsonb,
        ${createdAt}::timestamptz
      )
    `);
      await tx.execute(sql`
      insert into public.quote_lines (
        id, quote_id, rate_card_id, sku, quantity, term_months,
        unit_price_minor, overage_rate_minor, discount_bps, line_total_minor
      ) values (
        ${seed.line}::uuid, ${seed.quote}::uuid,
        '61000000-0000-4000-8000-000000000001'::uuid,
        'LOCKED-STORAGE-TB', 1, 12, 15000, 18000, 0, 180000
      )
    `);
    },
  );
}

beforeAll(async () => {
  await seedQuote({ quote: quoteId, series: seriesId, line: lineId });
});

afterAll(async () => {
  await runtime.client.end();
});

describe.sequential("authoritative portal command database recovery", () => {
  it("applies once, recovers the exact committed response before stale checks, and rejects a hash conflict", async () => {
    await expect(executor.execute(command)).resolves.toEqual({
      ok: true,
      aggregateVersion: 2,
      resultReference: `core:quotes:${quoteId}:version:2`,
      replayed: false,
    });
    await expect(executor.execute(command)).resolves.toEqual({
      ok: true,
      aggregateVersion: 2,
      resultReference: `core:quotes:${quoteId}:version:2`,
      replayed: true,
    });
    await expect(
      executor.execute({ ...command, payload: { altered: true } }),
    ).resolves.toMatchObject({
      ok: false,
      code: "AUTHORITATIVE_IDEMPOTENCY_CONFLICT",
      retryable: false,
    });
    const rows = await withInternalTransaction(
      runtime.db,
      `verify:${quoteId}`,
      (tx) =>
        tx.execute(sql`
          select status, row_version
          from public.quotes
          where id = ${quoteId}::uuid
        `),
    );
    expect(rows).toEqual([{ status: "expired", row_version: 2 }]);
  });
});

/**
 * A staff member acting inside a customer's account through an assisted
 * session. The command bridge re-reads their roles from the database, so the
 * approver permissions an assisted session never carries must stay withheld
 * there too, in the context and in the claim signed for the database.
 */
describe.sequential("assisted staff command re-authorization", () => {
  const staffOrganizationId = "30000000-0000-4000-8000-000000000008";
  const suffix = uuidV7().slice(-12);
  const staffUserId = crypto.randomUUID();
  const staffEmail = `assisted-admin-${suffix}@filone.test`;
  const assistedSessionId = crypto.randomUUID();
  const assistedReason = "Helping the customer clear an expired quote";
  const approvalQuote = {
    quote: uuidV7(),
    series: uuidV7(),
    line: uuidV7(),
  };
  const expiryQuote = { quote: uuidV7(), series: uuidV7(), line: uuidV7() };

  function assistedCommand(input: {
    action: string;
    aggregateId: string;
    payload?: Record<string, unknown>;
  }) {
    return {
      ...command,
      action: input.action,
      aggregateId: input.aggregateId,
      payload: input.payload ?? {},
      actor: { kind: "user", id: staffUserId } as const,
      assistedSessionId,
      assistedReason,
      idempotencyKey: `assisted-authoritative-${uuidV7()}`,
      requestId: `assisted-authoritative-${input.aggregateId}`,
    };
  }

  beforeAll(async () => {
    await seedQuote(approvalQuote);
    await seedQuote(expiryQuote);
    await withInternalTransaction(
      runtime.db,
      `seed:assisted:${suffix}`,
      async (tx) => {
        await tx.execute(sql`
          insert into public.commerce_users (
            id, workos_user_id, email, name, is_internal_staff, mfa_enrolled
          ) values (
            ${staffUserId}::uuid, ${`assisted_admin_${suffix}`},
            ${staffEmail}, 'Assisted Administrator', true, true
          )
        `);
        await tx.execute(sql`
          insert into public.memberships (id, organization_id, user_id, role)
          values (
            ${crypto.randomUUID()}::uuid, ${staffOrganizationId}::uuid,
            ${staffUserId}::uuid, 'commerce_admin'
          )
        `);
        await tx.execute(sql`
          insert into public.experience_assisted_sessions (
            id, authentication_session_id, internal_user_id,
            actor_snapshot_name, actor_snapshot_email, target_account_id,
            reason, started_at, expires_at, request_id
          ) values (
            ${assistedSessionId}::uuid, ${`auth-session-${suffix}`},
            ${staffUserId}::uuid, 'Assisted Administrator', ${staffEmail},
            ${accountId}::uuid, ${assistedReason},
            ${new Date(now.getTime() - 60_000).toISOString()}::timestamptz,
            ${new Date(now.getTime() + 10 * 60_000).toISOString()}::timestamptz,
            ${`assisted-seed-${suffix}`}
          )
        `);
      },
    );
  });

  it("refuses an approval to a commerce administrator in an assisted session", async () => {
    await expect(
      executor.execute(
        assistedCommand({
          action: "approve_exception",
          aggregateId: approvalQuote.quote,
          payload: { reason: "Assisted approval must wait" },
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "AUTHORITATIVE_PERMISSION_REVOKED",
    });
    const rows = await withInternalTransaction(
      runtime.db,
      `verify:${approvalQuote.quote}`,
      (tx) =>
        tx.execute(sql`
          select status, row_version
          from public.quotes
          where id = ${approvalQuote.quote}::uuid
        `),
    );
    expect(rows).toEqual([{ status: "issued", row_version: 1 }]);
  });

  it("runs ordinary work with a context and signed claim that hold no approver permission", async () => {
    const mutate = vi.spyOn(
      DatabaseCoreFinanceRepository.prototype,
      "mutateWithReplay",
    );
    try {
      await expect(
        executor.execute(
          assistedCommand({ action: "expire", aggregateId: expiryQuote.quote }),
        ),
      ).resolves.toMatchObject({ ok: true, aggregateVersion: 2 });
      expect(mutate).toHaveBeenCalledTimes(1);
      const authorization = mutate.mock.calls[0]?.[0]
        .authorization as AuthorizationContext;
      expect(authorization.impersonation?.sessionId).toBe(assistedSessionId);
      expect(authorization.side).toBe("fil_one");
      const held = contextPermissions(authorization);
      for (const permission of assistedSessionWithheldPermissions)
        expect(held).not.toContain(permission);
      expect(held).toEqual(
        expect.arrayContaining([
          "quote:write",
          "operations:write",
          "impersonation:assume",
        ]),
      );

      // The claim the database receives for that context, signed exactly as
      // the core repository signs it.
      const signed = await withAuthorizedTransaction(
        runtime.db,
        {
          userId: authorization.userId,
          accountIds: authorization.accountIds,
          roles: authorization.roles,
          permissions: contextPermissions(authorization),
          ...(authorization.side ? { side: authorization.side } : {}),
          isInternalStaff: authorization.isInternalStaff,
          requestId: `assisted-claim-${suffix}`,
        },
        { secret: authorizationSecret },
        (tx) =>
          tx.execute(sql`
            select current_setting('app.authorization_context')::jsonb as claim,
                   public.app_has_permission('quote:approve') as quote_approve,
                   public.app_has_permission('billing:approve') as billing_approve,
                   public.app_has_permission('quote:write') as quote_write
          `),
      );
      const row = signed[0] as {
        claim: { permissions: string[]; side?: string };
        quote_approve: boolean;
        billing_approve: boolean;
        quote_write: boolean;
      };
      for (const permission of assistedSessionWithheldPermissions)
        expect(row.claim.permissions).not.toContain(permission);
      expect(row.claim.permissions).toContain("quote:write");
      expect(row.claim.side).toBe("fil_one");
      expect(row).toMatchObject({
        quote_approve: false,
        billing_approve: false,
        quote_write: true,
      });
    } finally {
      mutate.mockRestore();
    }
  });
});
