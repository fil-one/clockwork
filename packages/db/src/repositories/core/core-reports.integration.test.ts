import { randomUUID } from "node:crypto";

import { eq, sql, type SQL } from "drizzle-orm";

import { coreReportNames, ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import { accounts, commissionAccruals, invoices } from "../../schema";
import {
  coreReportSources,
  DatabaseCoreError,
  DatabaseCoreFinanceRepository,
} from "./database-finance";
import { FixtureTaxPort } from "./tax-fixture";

/**
 * The §17 reporting layer, bound to what it can actually read, and to whom.
 *
 * `coreReportNames` in @clockwork/contracts is a catalogue, and a catalogue is
 * a declaration. This file is the thing that makes it a claim.
 *
 * The first version of that binding was weaker than it read. It required a
 * `Record<CoreReportName, ...>` to name *a* relation, and then asserted rows for
 * five hard-coded names. A fictional report pointing at any relation in the
 * database satisfied both: the record was total, the query ran, and the five
 * names it checked were not the fictional one. What is required now, of every
 * name in the catalogue:
 *
 *   1. the relation is named after the report (`core_` + the report name), so a
 *      new entry cannot borrow an existing relation that has nothing to do with
 *      it;
 *   2. that relation exists, is a view, and is `security_invoker` -- a report
 *      may not be pointed at a base table, whose RLS would then be evaluated as
 *      whoever the transaction runs as;
 *   3. the account column it declares exists on it, so an account-scoped read
 *      cannot silently degrade to an unfiltered one;
 *   4. `clockwork_runtime` holds `select` on it if and only if the source
 *      declares the report tenant-reachable -- the binding between the refusal
 *      list in `report()` and the grants in SQL, which were two lists until
 *      001397 and disagreed about all three reports 001396 added;
 *   5. a caller of the class the catalogue claims actually reaches it: an
 *      internal operator for every report, and a real non-internal account
 *      party for every tenant report, with a typed refusal and not a driver
 *      error for the internal ones;
 *   6. the report returns rows whenever its relation has any. That replaces the
 *      five hard-coded names: it is derived from the fixture, so a report added
 *      over a populated relation cannot pass by returning nothing.
 *
 * Three of the eleven had no view at all before 001396: ARR/MRR, billing and
 * collections, and commission and settlement. Their content is asserted below
 * rather than just their reachability, because "the query ran" is what the
 * declaration problem looks like when it comes back as a test.
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

/** Seeded demo data: the direct order, the referral order, its partner. */
const directOrderId = "80000000-0000-4000-8000-000000000001";
const referralOrderId = "80000000-0000-4000-8000-000000000002";
const resaleOrderId = "80000000-0000-4000-8000-000000000003";
const referralInvoiceId = "90000000-0000-4000-8000-000000000002";
const referralAccrualId = "93500000-0000-4000-8000-000000000001";
const overdueInvoiceId = "90000000-0000-4000-8000-000000000001";
const partnerAccountId = "10000000-0000-4000-8000-000000000002";
const userId = "20000000-0000-4000-8000-000000000002";

const directAccountId = "10000000-0000-4000-8000-000000000001";

const internal: AuthorizationContext = {
  userId: ids.user.parse(userId),
  accountIds: [],
  roles: ["owner", "internal_operator"],
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

/**
 * A real tenant role on a real seeded account: an `owner`, which holds
 * `report:read`. This is the caller the three reports 001396 added met with
 * `42501 permission denied for view core_commission_settlement`.
 */
const tenant = (accountId: string): AuthorizationContext => ({
  userId: ids.user.parse(userId),
  accountIds: [ids.account.parse(accountId)],
  roles: ["owner"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
});

const read = (report: (typeof coreReportNames)[number], accountId?: string) =>
  repository.report({
    report,
    ...(accountId ? { accountId } : {}),
    limit: 100,
    authorization: internal,
  });

const readAs = (
  authorization: AuthorizationContext,
  report: (typeof coreReportNames)[number],
  accountId: string,
) => repository.report({ report, accountId, limit: 100, authorization });

/** One scalar out of the running database, as the internal service pool. */
async function scalar<T>(query: SQL): Promise<T> {
  const [row] = (await db.execute(query)) as unknown as Record<
    string,
    unknown
  >[];
  return Object.values(row ?? {})[0] as T;
}

/**
 * A report row's columns. They come back as whatever the view selected, so the
 * typed shape stops at "a record", and reading one is a lookup rather than a
 * property access.
 */
const columns = (item: { data: unknown }): Record<string, unknown> =>
  item.data as Record<string, unknown>;
const rowWhere = (
  page: { items: { data: unknown }[] },
  key: string,
  value: string,
): Record<string, unknown> => {
  const found = page.items.map(columns).find((row) => row[key] === value);
  if (!found) throw new Error(`no report row with ${key} = ${value}`);
  return found;
};

afterAll(async () => {
  await client.end();
});

/** Rows in each report's relation, read straight out of the database. */
const relationRowCount = new Map<string, number>();

beforeAll(async () => {
  for (const report of coreReportNames) {
    const relation = coreReportSources[report].relation;
    const exists = await scalar<string | null>(
      sql`select to_regclass(${`public.${relation}`})::text`,
    );
    relationRowCount.set(
      report,
      exists === null
        ? -1
        : Number(
            await scalar<string | number>(
              sql`select count(*) from ${sql.identifier(relation)}`,
            ),
          ),
    );
  }
}, 120_000);

describe("the §17 reporting layer", () => {
  it("names every report after the relation it is served from, and that relation is a security-invoker view", async () => {
    // What stops a catalogue entry pointing at whatever relation happens to
    // exist. All eleven satisfy it, so a twelfth has to create its own view --
    // it cannot borrow `accounts` and call itself a report.
    const wrong: string[] = [];
    for (const report of coreReportNames) {
      const source = coreReportSources[report];
      if (source.relation !== `core_${report}`)
        wrong.push(
          `${report}: served from ${source.relation}, which is not core_${report}`,
        );
      const kind = await scalar<string | null>(
        sql`select relkind::text from pg_class
            where oid = to_regclass(${`public.${source.relation}`})`,
      );
      if (kind !== "v")
        wrong.push(`${report}: ${source.relation} is not a view`);
      const invoker = await scalar<string | null>(
        sql`select option_value
            from pg_class,
              lateral pg_options_to_table(pg_class.reloptions)
            where oid = to_regclass(${`public.${source.relation}`})
              and option_name = 'security_invoker'`,
      );
      if (invoker !== "true" && invoker !== "on")
        wrong.push(
          `${report}: ${source.relation} is not security_invoker, so its rows would not be scoped by the caller`,
        );
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  it("declares an account column that exists on the relation, where it declares one", async () => {
    // An account filter naming a column the view does not have would raise
    // 42703 for a tenant and go unnoticed for an internal caller, who never
    // passes an account.
    const missing: string[] = [];
    for (const report of coreReportNames) {
      const source = coreReportSources[report];
      if (!source.accountColumn) continue;
      const present = await scalar<string | number>(
        sql`select count(*) from information_schema.columns
            where table_schema = 'public' and table_name = ${source.relation}
              and column_name = ${source.accountColumn}`,
      );
      if (Number(present) !== 1)
        missing.push(
          `${report}: ${source.relation} has no ${source.accountColumn} column`,
        );
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("grants the tenant role exactly the reports it declares tenant-reachable", async () => {
    // The binding that did not exist. `report()`'s refusal list and the SQL
    // grants were two lists: the eight views 000100 shipped were in one or the
    // other, and the three 001396 added were in NEITHER, so an owner on a
    // partner account passed the refusal and hit
    // `42501 permission denied for view core_commission_settlement`.
    const disagreements: string[] = [];
    for (const report of coreReportNames) {
      const source = coreReportSources[report];
      const granted = await scalar<boolean>(
        sql`select has_table_privilege('clockwork_runtime', ${`public.${source.relation}`}, 'select')`,
      );
      if (granted !== (source.audience === "tenant"))
        disagreements.push(
          `${report}: declared ${source.audience}, but clockwork_runtime ${granted ? "holds" : "does not hold"} select on ${source.relation}`,
        );
      const service = await scalar<boolean>(
        sql`select has_table_privilege('clockwork_service', ${`public.${source.relation}`}, 'select')`,
      );
      if (!service)
        disagreements.push(
          `${report}: the internal service pool cannot read ${source.relation}`,
        );
    }
    expect(disagreements, disagreements.join("\n")).toEqual([]);
  });

  it("serves every report in the catalogue to an internal operator", async () => {
    const unreadable: string[] = [];
    for (const report of coreReportNames) {
      try {
        const page = await read(report);
        expect(Array.isArray(page.items)).toBe(true);
      } catch (error) {
        unreadable.push(`${report}: ${(error as Error).message}`);
      }
    }
    expect(unreadable, unreadable.join("\n")).toEqual([]);
  });

  it("serves every tenant report to a real account party, and refuses every internal one in words", async () => {
    // Run as `clockwork_runtime` through the tenant transaction, which is where
    // the missing grant surfaced. A driver error here is the finding: the
    // caller holds `report:read`, named an account they hold, and was not
    // refused.
    const wrong: string[] = [];
    for (const report of coreReportNames) {
      const source = coreReportSources[report];
      try {
        const page = await readAs(
          tenant(directAccountId),
          report,
          directAccountId,
        );
        if (source.audience === "internal")
          wrong.push(
            `${report}: declared internal, but a tenant read returned ${page.items.length} rows`,
          );
      } catch (error) {
        if (source.audience === "tenant")
          wrong.push(
            `${report}: tenant read failed -- ${(error as Error).message}`,
          );
        else {
          expect(error).toBeInstanceOf(DatabaseCoreError);
          expect((error as Error).message).toBe(
            "This management report is restricted to internal operators",
          );
        }
      }
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  it("returns rows for every report whose relation has any", async () => {
    // Replaces a hard-coded list of five names, which said nothing about a
    // sixth. The expectation is derived from the fixture: if the relation the
    // report is served from has rows, the report has to come back with them,
    // and a view that selects from the wrong place returns a page that does not
    // match its own relation.
    const empty: string[] = [];
    for (const report of coreReportNames) {
      const rows = relationRowCount.get(report) ?? -1;
      if (rows <= 0) continue;
      const page = await read(report);
      if (page.items.length === 0)
        empty.push(
          `${report}: ${coreReportSources[report].relation} holds ${rows} rows and the report returned none`,
        );
    }
    expect(empty, empty.join("\n")).toEqual([]);
    // And the fixture is populated enough for the check above to mean
    // something: a seed that emptied every report would make it vacuous.
    expect(
      coreReportNames.filter(
        (report) => (relationRowCount.get(report) ?? 0) > 0,
      ).length,
    ).toBeGreaterThanOrEqual(5);
  });

  it("states ARR per contract on the merchant-of-record basis", async () => {
    const page = await read("arr_mrr");
    const direct = rowWhere(page, "order_id", directOrderId);
    expect(direct.mrr_minor).toBe("15000");
    expect(direct.arr_minor).toBe("180000");
    expect(direct.revenue_basis).toBe("gross");
    // The resale contract is recognised at its transfer price (168000 over
    // twelve months), not at the 216000 the partner charges its own client.
    const resale = rowWhere(page, "order_id", resaleOrderId);
    expect(resale.revenue_basis).toBe("transfer_price");
    expect(resale.mrr_minor).toBe("14000");
    // One row per contract. Twelve would mean the report returned the forecast
    // month by month and called each of them an annual run rate.
    expect(
      page.items.map(columns).filter((row) => row.order_id === directOrderId),
    ).toHaveLength(1);
  });

  it("ages and traces every invoice in billing and collections", async () => {
    const page = await read("billing_collections");
    expect(page.items).toHaveLength(
      (await db.select({ id: invoices.id }).from(invoices)).length,
    );
    const overdue = rowWhere(page, "invoice_id", overdueInvoiceId);
    // The seeded overdue invoice carries a full payment that is under dispute:
    // the projection says unpaid, the payments say the cash arrived, and the
    // report has to show both or the tie-out is invisible.
    expect(overdue.paid_minor).toBe("0");
    expect(overdue.collected_minor).toBe("180000");
    expect(overdue.open_dispute_count).toBe(1);
    expect(overdue.sourceRecordIds).toMatchObject({
      invoiceId: overdueInvoiceId,
      orderId: directOrderId,
    });
  });

  it("keeps commission holdback and settlement stage separate", async () => {
    const page = await read("commission_settlement");
    const accrual = rowWhere(page, "accrual_id", referralAccrualId);
    expect(accrual.invoice_id).toBe(referralInvoiceId);
    expect(accrual.gross_commission_minor).toBe("14400");
    expect(accrual.holdback_minor).toBe("1440");
    expect(accrual.payable_minor).toBe("12960");
    expect(accrual.is_clawback).toBe(false);
    expect(accrual.settlement_stage).toBe("accrued");
    expect(accrual.order_id).toBe(referralOrderId);
  });

  it("narrows a report to one account when asked", async () => {
    const scoped = await read("commission_settlement", partnerAccountId);
    expect(scoped.items.length).toBeGreaterThan(0);
    for (const row of scoped.items.map(columns))
      expect(row.partner_account_id).toBe(partnerAccountId);
    // A partner with no accruals reads an empty page rather than another
    // partner's, which is what makes the narrowing worth having.
    const otherPartner = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, "10000000-0000-4000-8000-000000000003"));
    expect(otherPartner).toHaveLength(1);
    const empty = await read(
      "commission_settlement",
      "10000000-0000-4000-8000-000000000003",
    );
    const foreign = await db
      .select({ id: commissionAccruals.id })
      .from(commissionAccruals)
      .where(
        eq(
          commissionAccruals.partnerAccountId,
          "10000000-0000-4000-8000-000000000003",
        ),
      );
    expect(empty.items).toHaveLength(foreign.length);
  });

  it("refuses a report to a caller with no account scope of their own", () => {
    // Unchanged behaviour, asserted because the three new reports join it: a
    // non-internal caller must name an account they hold.
    expect(() =>
      repository.report({
        report: "billing_collections",
        limit: 10,
        authorization: {
          userId: ids.user.parse(randomUUID()),
          accountIds: [],
          roles: ["owner"],
          isInternalStaff: false,
          mfaVerified: true,
          recentAuthenticationVerified: true,
        },
      }),
    ).toThrow(/Report account scope was not found/);
  });
});
