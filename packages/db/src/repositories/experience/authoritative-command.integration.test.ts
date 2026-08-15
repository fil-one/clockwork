import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { uuidV7 } from "@clockwork/contracts";

import { createRuntimeDatabase } from "../../client";
import { withInternalTransaction } from "../../transaction";
import { DatabaseAuthoritativePortalCommandExecutor } from "./authoritative-command";
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

beforeAll(async () => {
  const createdAt = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const expiresAt = new Date(now.getTime() - 5 * 60_000).toISOString();
  await withInternalTransaction(runtime.db, `seed:${quoteId}`, async (tx) => {
    await tx.execute(sql`
      insert into public.quotes (
        id, account_id, price_book_id, series_id, revision, status, currency,
        total_minor, margin_floor_result, expires_at, created_by,
        rendered_document_id, created_at, updated_at, row_version, immutable_at
      ) values (
        ${quoteId}::uuid, ${accountId}::uuid,
        '60000000-0000-4000-8000-000000000001'::uuid,
        ${seriesId}::uuid, 1, 'issued', 'USD', 180000, 'pass',
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
        ${quoteId}::uuid, 'direct', 'fil_one', 'fil_one', ${accountId}::uuid,
        '{}'::jsonb, '{"exceptionReasons":[]}'::jsonb,
        ${createdAt}::timestamptz
      )
    `);
    await tx.execute(sql`
      insert into public.quote_lines (
        id, quote_id, rate_card_id, sku, quantity, term_months,
        unit_price_minor, overage_rate_minor, discount_bps, line_total_minor
      ) values (
        ${lineId}::uuid, ${quoteId}::uuid,
        '61000000-0000-4000-8000-000000000001'::uuid,
        'LOCKED-STORAGE-TB', 1, 12, 15000, 18000, 0, 180000
      )
    `);
  });
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
