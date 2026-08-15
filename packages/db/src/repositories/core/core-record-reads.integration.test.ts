import { randomUUID } from "node:crypto";

import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import {
  accounts,
  creditNotes,
  procurementProfiles,
  refunds,
  reportExports,
} from "../../schema";
import { accountingExports } from "../../schema/core/finance";
import {
  databaseCoreResourceNames,
  DatabaseCoreError,
  DatabaseCoreFinanceRepository,
  type DatabaseCoreResourceName,
} from "./database-finance";
import { FixtureTaxPort } from "./tax-fixture";

/**
 * `GET /v1/core/records/{resource}` is advertised for sixteen resources. It was
 * implemented for seven, and the other nine reached the dispatch default and
 * came back as "reads require their dedicated report or repository" -- an error
 * on a URL the published OpenAPI document tells a caller to call.
 *
 * The repair is a branch each, and this file is what holds it. Reachability
 * alone would not: a branch selecting from the wrong table returns an empty
 * page and looks like success. So every one of the nine is given a row here --
 * from the demo seed where it has one, written by this file where it does not
 * -- and the page has to come back carrying it.
 *
 * The compile-time half is in `list()`, where the switch is total over the
 * resource union and the `default` narrows to `never`, so a resource added to
 * the advertised set without a branch does not build.
 *
 * The narrowing assertions matter separately. Five of the nine hang off an
 * order or an invoice rather than carrying an account column, so `accountId`
 * has to walk the same chain the row-level policy walks; a filter silently
 * dropped would return every row and still look like success.
 */

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 3,
  role: "clockwork_service",
  ssl: false,
});
const repository = new DatabaseCoreFinanceRepository({
  database: db,
  pricingDatabase: db,
  authorizationSecret,
  tax: new FixtureTaxPort(),
});

/** Seeded demo data. */
const seededAccountIds = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "10000000-0000-4000-8000-000000000004",
  "10000000-0000-4000-8000-000000000005",
  "10000000-0000-4000-8000-000000000006",
  "10000000-0000-4000-8000-000000000007",
  "10000000-0000-4000-8000-000000000008",
  "10000000-0000-4000-8000-000000000009",
] as const;
const directAccountId = seededAccountIds[0];
const referralClientAccountId = seededAccountIds[3];
const referralOrderId = "80000000-0000-4000-8000-000000000002";
const referralInvoiceId = "90000000-0000-4000-8000-000000000002";
const referralPaymentId = "91000000-0000-4000-8000-000000000002";
const userId = "20000000-0000-4000-8000-000000000002";
const approverUserId = "20000000-0000-4000-8000-000000000001";

const run = randomUUID().replaceAll("-", "").slice(0, 10);
const written = {
  // A procurement profile is unique per account, so this run brings its own
  // account rather than competing with whatever else has claimed a seeded one.
  procurementAccountId: randomUUID(),
  procurementProfileId: randomUUID(),
  creditNoteId: randomUUID(),
  refundId: randomUUID(),
  accountingExportId: randomUUID(),
  reportExportId: randomUUID(),
};

const internal: AuthorizationContext = {
  userId: ids.user.parse(userId),
  accountIds: [...seededAccountIds, written.procurementAccountId].map(
    (accountId) => ids.account.parse(accountId),
  ),
  roles: ["owner", "internal_operator"],
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

const list = (resource: DatabaseCoreResourceName, accountId?: string) =>
  repository.list({
    resource,
    ...(accountId ? { accountId } : {}),
    limit: 100,
    authorization: internal,
  });

const idsIn = (page: { items: { id: string }[] }) =>
  page.items.map((item) => item.id);

beforeAll(async () => {
  // Rows for the four resources the demo seed leaves empty. Each belongs to
  // this run and is written the way its own writer writes it.
  await db.insert(accounts).values({
    id: written.procurementAccountId,
    legalName: `Record reads probe ${run}`,
    relationshipRoles: ["direct_client"],
    registeredAddress: {},
    billingContact: {},
    apContact: {},
    invoiceDeliveryEmail: `record-reads-${run}@probe.invalid`,
    domain: `record-reads-${run}.probe.invalid`,
    country: "US",
    currency: "USD",
  });
  await db.insert(procurementProfiles).values({
    id: written.procurementProfileId,
    accountId: written.procurementAccountId,
  });
  await db.insert(creditNotes).values({
    id: written.creditNoteId,
    invoiceId: referralInvoiceId,
    orderId: referralOrderId,
    stripeCreditNoteId: `cn_record_reads_${run}`,
    currency: "USD",
    amountMinor: 1_000n,
    reasonCode: "service_credit",
    approvedBy: approverUserId,
    status: "issued",
  });
  await db.insert(refunds).values({
    id: written.refundId,
    paymentId: referralPaymentId,
    orderId: referralOrderId,
    stripeRefundId: `re_record_reads_${run}`,
    currency: "USD",
    amountMinor: 500n,
    reasonCode: "goodwill",
    status: "succeeded",
  });
  await db.insert(accountingExports).values({
    id: written.accountingExportId,
    exportType: "ar_issuance",
    periodStartsOn: "2026-07-01",
    periodEndsOn: "2026-07-31",
    currency: "USD",
    idempotencyKey: `record-reads-${run}`,
    status: "pending",
    totalDebitMinor: 0n,
    totalCreditMinor: 0n,
  });
  await db.insert(reportExports).values({
    id: written.reportExportId,
    requestedBy: userId,
    report: "billing_collections",
    parameters: {},
    status: "pending",
  });
}, 60_000);

afterAll(async () => {
  await client.end();
});

describe("the advertised core record reads", () => {
  it("serves a page for every advertised resource", async () => {
    const unread: string[] = [];
    for (const resource of databaseCoreResourceNames) {
      try {
        const page = await list(resource);
        expect(Array.isArray(page.items)).toBe(true);
        for (const item of page.items) expect(item.resource).toBe(resource);
      } catch (error) {
        unread.push(`${resource}: ${(error as Error).message}`);
      }
    }
    expect(unread, unread.join("\n")).toEqual([]);
  });

  it("returns the row each of the nine formerly unread resources actually holds", async () => {
    const seeded: [DatabaseCoreResourceName, string][] = [
      ["amendments", "82000000-0000-4000-8000-000000000001"],
      ["commitments", "84000000-0000-4000-8000-000000000001"],
      ["disputes", "92000000-0000-4000-8000-000000000001"],
      ["marketplace_reconciliations", "90200000-0000-4000-8000-000000000001"],
      ["procurement_profiles", written.procurementProfileId],
      ["credit_notes", written.creditNoteId],
      ["refunds", written.refundId],
      ["accounting_exports", written.accountingExportId],
      ["reports", written.reportExportId],
    ];
    const missing: string[] = [];
    for (const [resource, id] of seeded) {
      const page = await list(resource);
      if (!idsIn(page).includes(id))
        missing.push(`${resource} did not return ${id}`);
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("narrows an order-derived resource to the account that holds the order", async () => {
    const all = await list("amendments");
    const scoped = await list("amendments", directAccountId);
    expect(scoped.items.length).toBeGreaterThan(0);
    expect(scoped.items.length).toBeLessThanOrEqual(all.items.length);
    // A different account must not be handed the same rows. A filter that was
    // silently dropped would return them.
    const other = await list("amendments", referralClientAccountId);
    const scopedIds = new Set(idsIn(scoped));
    expect(idsIn(other).filter((id) => scopedIds.has(id))).toEqual([]);
  });

  it("narrows an invoice-derived resource to the account that was billed", async () => {
    const scoped = await list("credit_notes", referralClientAccountId);
    expect(idsIn(scoped)).toContain(written.creditNoteId);
    const other = await list("credit_notes", directAccountId);
    expect(idsIn(other)).not.toContain(written.creditNoteId);
  });

  it("narrows a payment-derived resource to the account that was billed", async () => {
    const scoped = await list("refunds", referralClientAccountId);
    expect(idsIn(scoped)).toContain(written.refundId);
    const other = await list("refunds", directAccountId);
    expect(idsIn(other)).not.toContain(written.refundId);
  });

  it("keeps the two account-less ledgers to internal operators", () => {
    // Their row-level policy is `app_is_internal()`, so a tenant session reads
    // nothing from either table however it asks. The refusal says that instead
    // of handing back an empty page that looks like an answer.
    for (const resource of [
      "accounting_exports",
      "marketplace_reconciliations",
    ] as const)
      expect(() =>
        repository.list({
          resource,
          limit: 10,
          authorization: { ...internal, isInternalStaff: false },
        }),
      ).toThrow(DatabaseCoreError);
  });

  it("pages a resource that has more rows than the limit", async () => {
    const first = await repository.list({
      resource: "invoices",
      limit: 2,
      authorization: internal,
    });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await repository.list({
      resource: "invoices",
      limit: 2,
      cursor: first.nextCursor as string,
      authorization: internal,
    });
    const firstIds = new Set(idsIn(first));
    expect(idsIn(second).filter((id) => firstIds.has(id))).toEqual([]);
  });
});
