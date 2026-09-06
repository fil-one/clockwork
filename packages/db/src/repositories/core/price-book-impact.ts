import { sql } from "drizzle-orm";
import { z } from "zod";

import type { RuntimeDatabase } from "../../client";
import { withInternalTransaction } from "../../transaction";

const count = z.coerce
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export const PriceBookImpactRecordSchema = z.object({
  id: z.uuid(),
  rowVersion: z.number().int().positive(),
  status: z.enum(["draft", "active", "retired"]),
  quoteRevisions: count,
  quoteSeries: count,
  quotedAccounts: count,
  draftQuotes: count,
  unexpiredIssuedQuotes: count,
  expiredIssuedQuotes: count,
  acceptedQuotes: count,
  orders: count,
  immutableOrders: count,
  openOrders: count,
  governingAgreements: count,
  orderLines: count,
  activeEntitlements: count,
  suspendedEntitlements: count,
});
export type PriceBookImpactRecord = z.infer<typeof PriceBookImpactRecordSchema>;

export interface PriceBookImpactSnapshot {
  asOf: string;
  records: readonly PriceBookImpactRecord[];
}

/** Complete reference counts for the requested books, not a revenue forecast. */
export class DatabasePriceBookImpactReader {
  public constructor(private readonly database: RuntimeDatabase) {}

  public async read(input: {
    userId: string;
    bookIds: readonly string[];
    requestId?: string;
    now?: Date;
  }): Promise<PriceBookImpactSnapshot> {
    const userId = z.uuid().parse(input.userId);
    const bookIds = z.array(z.uuid()).max(500).parse(input.bookIds);
    const asOf = (input.now ?? new Date()).toISOString();
    return withInternalTransaction(
      this.database,
      input.requestId ?? `price-book-impact:${crypto.randomUUID()}`,
      async (tx) => {
        const authorized = await tx.execute(sql`
          select u.id from commerce_users u
          where u.id = ${userId}::uuid and u.is_internal_staff
          and exists (select 1 from memberships m where m.user_id=u.id
            and m.role in ('finance_approver','internal_operator'))
        `);
        if (!authorized.length)
          throw new Error("PRICE_BOOK_IMPACT_ACCESS_DENIED");
        if (!bookIds.length) return { asOf, records: [] };
        const ids = sql.join(
          bookIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        );
        // Each relation aggregates before joining; multiple lines/entitlements
        // cannot multiply quotes, orders or distinct governing agreements.
        const rows = await tx.execute(sql`
          with scoped_books as (
            select id, row_version, status from price_books where id in (${ids})
          ), scoped_quotes as (
            select q.* from quotes q join scoped_books b on b.id=q.price_book_id
          ), quote_counts as (
            select price_book_id,
              count(*) as revisions, count(distinct series_id) as series,
              count(distinct account_id) as accounts,
              count(*) filter(where status='draft') as drafts,
              count(*) filter(where status='issued' and expires_at>${asOf}::timestamptz) as issued,
              count(*) filter(where status='issued' and expires_at<=${asOf}::timestamptz) as expired,
              count(*) filter(where status='accepted') as accepted
            from scoped_quotes group by price_book_id
          ), scoped_orders as (
            select o.*, q.price_book_id from orders o join scoped_quotes q on q.id=o.quote_id
          ), order_counts as (
            select price_book_id, count(*) as total,
              count(*) filter(where immutable_at is not null) as immutable,
              count(*) filter(where status in ('accepted','provisioning','active','amended')) as open,
              count(distinct agreement_id) as agreements
            from scoped_orders group by price_book_id
          ), line_counts as (
            select o.price_book_id, count(*) as total
            from order_lines l join scoped_orders o on o.id=l.order_id group by o.price_book_id
          ), entitlement_counts as (
            select o.price_book_id,
              count(*) filter(where e.status='active') as active,
              count(*) filter(where e.status='suspended_write') as suspended
            from entitlements e join scoped_orders o on o.id=e.order_id group by o.price_book_id
          )
          select b.id, b.row_version as "rowVersion", b.status,
            coalesce(q.revisions,0) as "quoteRevisions", coalesce(q.series,0) as "quoteSeries",
            coalesce(q.accounts,0) as "quotedAccounts", coalesce(q.drafts,0) as "draftQuotes",
            coalesce(q.issued,0) as "unexpiredIssuedQuotes", coalesce(q.expired,0) as "expiredIssuedQuotes",
            coalesce(q.accepted,0) as "acceptedQuotes", coalesce(o.total,0) as orders,
            coalesce(o.immutable,0) as "immutableOrders", coalesce(o.open,0) as "openOrders",
            coalesce(o.agreements,0) as "governingAgreements", coalesce(l.total,0) as "orderLines",
            coalesce(e.active,0) as "activeEntitlements", coalesce(e.suspended,0) as "suspendedEntitlements"
          from scoped_books b
          left join quote_counts q on q.price_book_id=b.id
          left join order_counts o on o.price_book_id=b.id
          left join line_counts l on l.price_book_id=b.id
          left join entitlement_counts e on e.price_book_id=b.id
          order by b.id
        `);
        return {
          asOf,
          records: rows.map((row) => PriceBookImpactRecordSchema.parse(row)),
        };
      },
      { isolationLevel: "repeatable read" },
    );
  }
}
