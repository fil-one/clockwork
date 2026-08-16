import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";

import { createRuntimeDatabase } from "../../client";
import { withInternalTransaction } from "../../transaction";
import { DatabaseCoreWorkflowDispatchStore } from "../workflows/core-dispatch";
import { DatabaseCoreFinanceRepository } from "./database-finance";
import { coreSnapshotHash } from "./finance";
import {
  canonicalTaxHash,
  loadPersistedRuleBooks,
  runDetermination,
  taxRequestFromStoredInput,
} from "./tax-determination";

/**
 * THE TEST THAT MATTERS MOST: every determination this database holds is
 * replayed against the books it was pinned to, and its answer must still be the
 * answer that was stored.
 *
 * A persisted tax figure is a claim that will be defended years later to
 * somebody who was not in the room. What makes it defensible is not that it was
 * written down but that it can be REACHED AGAIN from what it was computed from,
 * so `core_invoice_tax_determinations.determination_input` stores the question
 * — both parties, their registrations, the lines with their frozen tax codes,
 * the tax point, and the exact books with their versions — and this replays it.
 *
 * WHAT THIS CATCHES that nothing else does. The rates themselves cannot move:
 * `protect_published_tax_rule_book` (001411) freezes a published book and its
 * rates, and a rate can only ever arrive as a new VERSION. What is not frozen is
 * the ENGINE — place of supply, the reverse-charge rule, the registration
 * lookup, the rounding, the stacking, and the composition that assembles the
 * books. A change to any of those silently re-prices history, because history
 * is a set of numbers in a table with nothing comparing them to anything. This
 * compares them.
 *
 * It runs over EVERY stored determination rather than over a fixture it writes
 * itself, so every determination any other suite in this package produces is
 * carried into it and a rounding change anywhere shows up here.
 */

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";

const { db, client } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 2,
  role: "clockwork_service",
  ssl: false,
});

afterAll(async () => {
  await client.end();
});

const authorizationSecret = "clockwork-local-auth-context-secret-change-me";
const repository = new DatabaseCoreFinanceRepository({
  database: db,
  pricingDatabase: db,
  authorizationSecret,
});

/**
 * A billed order of this suite's own, so the replay never passes because
 * another file happened to run first and never fails because none did.
 *
 * The rows are the ones acceptance writes — an accepted quote, an immutable
 * order, its commercial profile, its line snapshot with the tax code frozen
 * into it, and the selling-entity binding, made by the same database function
 * the acceptance writer calls. The INVOICE is then written by the real command,
 * so the determination under replay is one the production writer produced.
 */
const BUYER = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
const ORGANIZATION = "30000000-0000-4000-8000-000000000001";
const suffix = randomUUID().slice(0, 8);
const quoteId = randomUUID();
const orderId = randomUUID();
const orderLineId = randomUUID();
const quoteLineId = randomUUID();
const draftQuoteId = randomUUID();
const draftOrderId = randomUUID();
const draftOrderLineId = randomUUID();
const draftQuoteLineId = randomUUID();
const netMinor = 240_000n;
const draftNetMinor = 300_000n;

const authorization: AuthorizationContext = {
  userId: ids.user.parse(OWNER),
  accountIds: [ids.account.parse(BUYER)],
  roles: ["owner", "billing"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

async function billableOrder(input: {
  quoteId: string;
  orderId: string;
  orderLineId: string;
  quoteLineId: string;
  netMinor: bigint;
  label: string;
  provisioned: boolean;
}) {
  const lineSnapshot = {
    id: input.orderLineId,
    quoteLineId: input.quoteLineId,
    sku: "LOCKED-STORAGE-TB",
    region: "us-east-2",
    quantity: "1",
    termMonths: 12,
    unitPrice: { currency: "USD", minor: "20000" },
    overageRate: { currency: "USD", minor: "18000" },
    lineTotal: { currency: "USD", minor: input.netMinor.toString() },
    commitType: "term_drawdown",
    stripeTaxCode: "txcd_demo",
    qboIncomeAccount: "4000-Storage",
  };
  await withInternalTransaction(
    db,
    `tax-replay-fixture-${input.label}`,
    async (tx) => {
      await tx.execute(sql`
        insert into public.quotes (
          id, account_id, price_book_id, series_id, revision, status, currency,
          total_minor, margin_floor_result, expires_at, created_by, immutable_at
        ) values (
          ${input.quoteId}::uuid, ${BUYER}::uuid,
          '60000000-0000-4000-8000-000000000001'::uuid, ${randomUUID()}::uuid,
          1, 'accepted', 'USD', ${input.netMinor.toString()}::bigint, 'pass',
          '2027-12-31T00:00:00Z', ${OWNER}::uuid, '2026-08-16T09:00:00Z'
        )
      `);
      await tx.execute(sql`
        insert into public.quote_lines (
          id, quote_id, rate_card_id, sku, quantity, term_months,
          unit_price_minor, overage_rate_minor, line_total_minor
        ) values (
          ${input.quoteLineId}::uuid, ${input.quoteId}::uuid,
          '61000000-0000-4000-8000-000000000001'::uuid, 'LOCKED-STORAGE-TB',
          1, 12, 20000, 18000, ${input.netMinor.toString()}::bigint
        )
      `);
      await tx.execute(sql`
        insert into public.core_quote_commercial_profiles (
          quote_id, channel_shape, merchant_of_record, pricing_authority,
          billing_account_id, pricing_inputs, pricing_calculated_at
        ) values (
          ${input.quoteId}::uuid, 'direct', 'fil_one', 'fil_one', ${BUYER}::uuid,
          '{}'::jsonb, '2026-08-16T09:00:00Z'
        )
      `);
      await tx.execute(sql`
        insert into public.orders (
          id, quote_id, agreement_id, account_id, invoicing_account_id, sourcing,
          signer_user_id, authority_title, authority_attested, status,
          service_starts_on, service_ends_on, po_number, immutable_at
        ) values (
          ${input.orderId}::uuid, ${input.quoteId}::uuid,
          '51000000-0000-4000-8000-000000000001'::uuid, ${BUYER}::uuid,
          ${BUYER}::uuid, 'direct', ${OWNER}::uuid, 'Owner', true, 'active',
          '2026-08-16', '2027-08-15', ${`PO-${input.label}`},
          '2026-08-16T10:00:00Z'
        )
      `);
      await tx.execute(sql`
        insert into public.order_lines (
          id, order_id, quote_line_id, sku, quantity, unit_price_minor,
          overage_rate_minor
        ) values (
          ${input.orderLineId}::uuid, ${input.orderId}::uuid,
          ${input.quoteLineId}::uuid, 'LOCKED-STORAGE-TB', 1, 20000, 18000
        )
      `);
      await tx.execute(sql`
        insert into public.core_order_commercial_profiles (
          order_id, merchant_of_record, billing_shape,
          provisioning_idempotency_key, governing_agreement_version, accepted_at
        ) values (
          ${input.orderId}::uuid, 'fil_one', 'direct',
          ${`replay:${input.label}`}, 1, '2026-08-16T10:00:00Z'
        )
      `);
      await tx.execute(sql`
        insert into public.core_order_line_snapshots (
          order_line_id, snapshot, snapshot_hash
        ) values (
          ${input.orderLineId}::uuid, ${JSON.stringify(lineSnapshot)}::jsonb,
          ${coreSnapshotHash(lineSnapshot)}
        )
      `);
      // Through the same database function the acceptance writer calls, so the
      // supplier under determination is pinned the way a real order's is.
      await tx.execute(sql`
        select public.core_bind_order_selling_entity(
          ${input.orderId}::uuid, '2026-08-16T10:00:00Z'::timestamptz
        )
      `);
      if (input.provisioned)
        await tx.execute(sql`
          insert into public.entitlements (
            order_id, order_line_id, organization_id, sku, committed_quantity,
            region, activated_at, provisioned_resource_id, status
          ) values (
            ${input.orderId}::uuid, ${input.orderLineId}::uuid,
            ${ORGANIZATION}::uuid, 'LOCKED-STORAGE-TB', 1, 'us-east-2',
            '2026-08-16T10:30:00Z', ${`res-${input.label}`}, 'active'
          )
        `);
    },
  );
}

beforeAll(async () => {
  // TWO WRITERS, BOTH COVERED. `invoices:create` and
  // `ensureInvoiceDraftForProvisionedOrder` write the same row for the same
  // order by the same rule, and a determination that only one of them persisted
  // would be a hole exactly where 001393 says the two writers must agree.
  await billableOrder({
    quoteId,
    orderId,
    orderLineId,
    quoteLineId,
    netMinor,
    label: `replay-command-${suffix}`,
    provisioned: false,
  });
  await repository.mutate({
    resource: "invoices",
    id: randomUUID(),
    accountId: BUYER,
    action: "create",
    payload: { orderId, dueAt: "2026-09-30T00:00:00.000Z" },
    actor: { kind: "user", id: OWNER },
    authorization,
    requestId: `tax-replay-invoice-${suffix}`,
    idempotencyKey: `tax-replay-invoice-${suffix}-0000000000`,
    occurredAt: "2026-08-16T11:00:00.000Z",
  });

  await billableOrder({
    quoteId: draftQuoteId,
    orderId: draftOrderId,
    orderLineId: draftOrderLineId,
    quoteLineId: draftQuoteLineId,
    netMinor: draftNetMinor,
    label: `replay-draft-${suffix}`,
    provisioned: true,
  });
  await new DatabaseCoreWorkflowDispatchStore(
    db,
    authorizationSecret,
  ).ensureInvoiceDraftForProvisionedOrder({
    orderId: draftOrderId,
    requestId: `tax-replay-draft-${suffix}`,
    occurredAt: "2026-08-16T12:00:00.000Z",
  });
});

interface StoredDetermination extends Record<string, unknown> {
  invoice_id: string;
  determination_id: string;
  tax_minor: string;
  treatment: string;
  determination_input: unknown;
  determination_input_hash: string;
}

interface StoredLine extends Record<string, unknown> {
  line_id: string;
  jurisdiction: string;
  treatment: string;
  tax_code: string;
  rate_ppm: string;
  rate_kind: string;
  taxable_minor: string;
  tax_minor: string;
  rule_book_id: string;
  rule_book_version: number;
  legal_basis: string;
  notation: string;
}

const storedDeterminations = () =>
  withInternalTransaction(db, "tax-replay-load", async (transaction) => {
    const determinations = await transaction.execute<StoredDetermination>(sql`
      select invoice_id::text, determination_id::text, tax_minor::text,
             treatment, determination_input, determination_input_hash
      from public.core_invoice_tax_determinations
      order by invoice_id
    `);
    const lines = await transaction.execute<
      StoredLine & { invoice_id: string }
    >(sql`
      select invoice_id::text, line_id, jurisdiction, treatment, tax_code,
             rate_ppm::text, rate_kind, taxable_minor::text, tax_minor::text,
             rule_book_id::text, rule_book_version, legal_basis, notation
      from public.core_invoice_tax_lines
      order by invoice_id, line_id, jurisdiction
    `);
    return { determinations: [...determinations], lines: [...lines] };
  });

/** The comparable shape of one answer, from either side. */
const comparable = (line: {
  lineId: string;
  jurisdiction: string;
  treatment: string;
  taxCode: string;
  ratePpm: string;
  rateKind: string;
  taxableMinor: string;
  taxMinor: string;
  ruleBookId: string;
  ruleBookVersion: number;
  legalBasis: string;
  notation: string;
}) => ({ ...line });

describe("stored tax determinations replay to the same answer", () => {
  it("reproduces every stored determination from its stored question", async () => {
    const { determinations, lines } = await storedDeterminations();
    // A green run over an empty table proves nothing at all, and this file
    // exists precisely to be un-ignorable, so it refuses to pass on silence.
    expect(determinations.length).toBeGreaterThan(0);

    for (const determination of determinations) {
      const replayed = taxRequestFromStoredInput(
        determination.determination_input,
      );
      // The question hashes to what the database recorded, computed here by
      // the TypeScript canonicaliser and there by `private.canonical_jsonb_text`
      // (001300). Two canonicalisers that disagree would make the stored hash
      // meaningless, and only a comparison catches that.
      expect(canonicalTaxHash(determination.determination_input)).toBe(
        determination.determination_input_hash,
      );
      expect(replayed.inputHash).toBe(determination.determination_input_hash);
      // The determination's own identity is derived from the question, so a
      // replay of the same question is the same determination.
      expect(replayed.determinationId).toBe(determination.determination_id);

      const books = await withInternalTransaction(
        db,
        `tax-replay-books-${determination.invoice_id}`,
        (transaction) =>
          loadPersistedRuleBooks(transaction, replayed.ruleBookIds),
      );
      const result = runDetermination({
        determinationId: replayed.determinationId,
        request: replayed.request,
        books,
      });

      const stored = lines
        .filter((line) => line.invoice_id === determination.invoice_id)
        .map((line) =>
          comparable({
            lineId: line.line_id,
            jurisdiction: line.jurisdiction,
            treatment: line.treatment,
            taxCode: line.tax_code,
            ratePpm: line.rate_ppm,
            rateKind: line.rate_kind,
            taxableMinor: line.taxable_minor,
            taxMinor: line.tax_minor,
            ruleBookId: line.rule_book_id,
            ruleBookVersion: line.rule_book_version,
            legalBasis: line.legal_basis,
            notation: line.notation,
          }),
        );
      const reproduced = result.lines
        .map((line) =>
          comparable({
            lineId: line.lineId,
            jurisdiction: line.jurisdiction,
            treatment: line.treatment,
            taxCode: line.taxCode,
            ratePpm: line.ratePpm.toString(),
            rateKind: line.rateKind,
            taxableMinor: line.taxableMinor.toString(),
            taxMinor: line.taxMinor.toString(),
            ruleBookId: line.ruleBookId,
            ruleBookVersion: line.ruleBookVersion,
            legalBasis: line.legalBasis,
            notation: line.notation,
          }),
        )
        .sort(
          (left, right) =>
            left.lineId.localeCompare(right.lineId) ||
            left.jurisdiction.localeCompare(right.jurisdiction),
        );

      expect(reproduced).toEqual(stored);
      // And the header figure is the sum of the rows, replayed.
      expect(
        reproduced.reduce((total, line) => total + BigInt(line.taxMinor), 0n),
      ).toBe(BigInt(determination.tax_minor));
    }
  });

  /**
   * THE NEGATIVE CONTROL, without which the assertion above is decoration.
   *
   * A rate edit cannot happen in the database — published rates are immutable —
   * so it is made HERE, to the book the replay reads, one part per million on
   * the code the determination actually used. If the comparison above has any
   * teeth, this must fail; if it passes, the replay is comparing nothing and
   * every green run of it has been meaningless.
   */
  it("fails when a rate the determination used is edited by one part per million", async () => {
    const { determinations, lines } = await storedDeterminations();
    const charged = determinations.find((determination) =>
      lines.some(
        (line) =>
          line.invoice_id === determination.invoice_id &&
          line.treatment === "standard" &&
          BigInt(line.tax_minor) !== 0n,
      ),
    );
    // A suite with no taxed invoice in it cannot demonstrate this, and saying
    // so is better than passing quietly.
    expect(charged).toBeDefined();
    if (!charged) return;

    const replayed = taxRequestFromStoredInput(charged.determination_input);
    const books = await withInternalTransaction(
      db,
      `tax-replay-negative-${charged.invoice_id}`,
      (transaction) =>
        loadPersistedRuleBooks(transaction, replayed.ruleBookIds),
    );
    const chargedLine = lines.find(
      (line) =>
        line.invoice_id === charged.invoice_id && line.treatment === "standard",
    );
    expect(chargedLine).toBeDefined();
    const tampered = books.map((book) =>
      book.id !== chargedLine?.rule_book_id
        ? book
        : {
            ...book,
            rates: book.rates.map((rate) =>
              rate.taxCode === chargedLine.tax_code
                ? { ...rate, ratePpm: rate.ratePpm + 1 }
                : rate,
            ),
          },
    );
    const result = runDetermination({
      determinationId: replayed.determinationId,
      request: replayed.request,
      books: tampered,
    });
    const reproducedRates = result.lines.map((line) => line.ratePpm.toString());
    expect(reproducedRates).not.toContain(chargedLine?.rate_ppm);
  });

  /**
   * The pin is to a BOOK, not to a date, so publishing a successor cannot move
   * a determination that has already been made. This is the property 001413's
   * reversal rule rests on, checked against the persisted pins rather than
   * asserted about them.
   */
  it("pins every stored line to a book whose version it names", async () => {
    const { lines } = await storedDeterminations();
    expect(lines.length).toBeGreaterThan(0);
    const mismatched = await withInternalTransaction(
      db,
      "tax-replay-pins",
      async (transaction) =>
        transaction.execute<{ count: number }>(sql`
          select count(*)::int as count
          from public.core_invoice_tax_lines line
          join public.core_tax_rule_books book on book.id = line.rule_book_id
          where book.version <> line.rule_book_version
             or book.status not in ('active','retired')
        `),
    );
    expect([...mismatched][0]?.count).toBe(0);
  });
});
