import { asc, desc, eq, sql } from "drizzle-orm";

import type { RuntimeDatabase } from "../../client";
import { approvals, commerceUsers, priceBooks, rateCards } from "../../schema";
import { priceBookActivationEvents } from "../../schema/core/finance";
import { withInternalTransaction } from "../../transaction";

export interface PriceBookAdministrationRecord {
  id: string;
  name: string;
  currency: string;
  version: number;
  rowVersion: number;
  status: "draft" | "active" | "retired";
  effectiveFrom: string;
  effectiveTo: string | null;
  rateCardCount: number;
  regions: readonly string[];
  /** Present once a first authority has proposed activation. */
  activationRequestedBy: string | null;
  activationRequestedByEmail: string | null;
  activationRequestedAt: string | null;
  lastDecisionAt: string | null;
  lastDecisionReason: string | null;
}

/**
 * The read behind the finance activation surface. Drafts awaiting a second
 * authority are the point of the page, so this reads on the service connection
 * rather than the account-scoped runtime one.
 */
export class DatabasePriceBookAdministrationReader {
  public constructor(private readonly database: RuntimeDatabase) {}

  public list(input: { requestId?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    return withInternalTransaction(
      this.database,
      input.requestId ?? `price-book-administration:${crypto.randomUUID()}`,
      async (transaction): Promise<PriceBookAdministrationRecord[]> => {
        const books = await transaction
          .select({
            id: priceBooks.id,
            name: priceBooks.name,
            currency: priceBooks.currency,
            version: priceBooks.version,
            rowVersion: priceBooks.rowVersion,
            status: priceBooks.status,
            effectiveFrom: priceBooks.effectiveFrom,
            effectiveTo: priceBooks.effectiveTo,
            rateCardCount: sql<number>`count(distinct ${rateCards.id})::int`,
            regions: sql<
              string[]
            >`coalesce(array_agg(distinct ${rateCards.region}) filter (where ${rateCards.region} is not null), '{}')`,
          })
          .from(priceBooks)
          .leftJoin(rateCards, eq(rateCards.priceBookId, priceBooks.id))
          .groupBy(priceBooks.id)
          .orderBy(
            asc(priceBooks.currency),
            desc(priceBooks.version),
            asc(priceBooks.id),
          )
          .limit(limit);
        return Promise.all(
          books.map(async (book) => {
            const [pending, lastEvent] = await Promise.all([
              transaction
                .select({
                  requestedBy: approvals.requestedBy,
                  requestedAt: approvals.requestedAt,
                  email: commerceUsers.email,
                })
                .from(approvals)
                .leftJoin(
                  commerceUsers,
                  eq(commerceUsers.id, approvals.requestedBy),
                )
                .where(
                  sql`${approvals.action} = 'price_book_activation'
                    and ${approvals.objectId} = ${book.id}
                    and ${approvals.status} = 'pending'`,
                )
                .limit(1),
              transaction.query.priceBookActivationEvents.findFirst({
                where: eq(priceBookActivationEvents.priceBookId, book.id),
                orderBy: [desc(priceBookActivationEvents.createdAt)],
              }),
            ]);
            const request = pending[0];
            return {
              id: book.id,
              name: book.name,
              currency: book.currency,
              version: book.version,
              rowVersion: book.rowVersion,
              status: priceBookStatus(book.status),
              effectiveFrom: book.effectiveFrom,
              effectiveTo: book.effectiveTo,
              rateCardCount: book.rateCardCount,
              regions: book.regions,
              activationRequestedBy: request?.requestedBy ?? null,
              activationRequestedByEmail: request?.email ?? null,
              activationRequestedAt:
                request?.requestedAt?.toISOString() ?? null,
              lastDecisionAt: lastEvent?.createdAt.toISOString() ?? null,
              lastDecisionReason: lastEvent?.reason ?? null,
            };
          }),
        );
      },
    );
  }
}

function priceBookStatus(value: string): "draft" | "active" | "retired" {
  if (value === "draft" || value === "active" || value === "retired")
    return value;
  throw new Error("Price book status is unsupported");
}
