import { MoneySchema } from "@clockwork/contracts";
import type { DiscountMatrix, RateCard } from "@clockwork/domain/core";
import { asc, desc, eq, sql } from "drizzle-orm";

import type { RuntimeDatabase } from "../../client";
import { approvals, commerceUsers, priceBooks, rateCards } from "../../schema";
import { priceBookActivationEvents } from "../../schema/core/finance";
import { priceBookSchedules } from "../../schema/core/price-book-schedules";
import { withInternalTransaction } from "../../transaction";

export interface PriceBookAdministrationRecord {
  activationSchedule?: {
    id: string;
    status: "approved" | "executed" | "cancelled" | "expired";
    effectiveFrom: string;
    effectiveTo: string | null;
    approvedAt: string;
    completedAt: string | null;
    completionReason: string | null;
  };
  id: string;
  name: string;
  currency: string;
  version: number;
  rowVersion: number;
  status: "draft" | "active" | "retired";
  effectiveFrom: string;
  effectiveTo: string | null;
  rateCardCount: number;
  rateCards?: readonly RateCard[];
  discountMatrix?: DiscountMatrix;
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
            discountMatrix: priceBooks.discountMatrix,
            rateCardCount: sql<number>`count(distinct ${rateCards.id})::int`,
            regions: sql<
              string[]
            >`coalesce(array_agg(distinct ${rateCards.region}) filter (where ${rateCards.region} is not null), '{}')`,
          })
          .from(priceBooks)
          .leftJoin(rateCards, eq(rateCards.priceBookId, priceBooks.id))
          .groupBy(priceBooks.id)
          .orderBy(
            // Keep incumbent economics available for replacement review even
            // when newer drafts fill the bounded administration result.
            desc(sql`${priceBooks.status} = 'active'`),
            asc(priceBooks.currency),
            desc(priceBooks.version),
            asc(priceBooks.id),
          )
          .limit(limit);
        return Promise.all(
          books.map(async (book) => {
            const [pending, lastEvent, rates, schedule] = await Promise.all([
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
                    and (${approvals.status} = 'pending' or exists(select 1 from ${priceBookSchedules} s where s.approval_id=${approvals.id} and s.status='approved'))`,
                )
                .limit(1),
              transaction.query.priceBookActivationEvents.findFirst({
                where: eq(priceBookActivationEvents.priceBookId, book.id),
                orderBy: [desc(priceBookActivationEvents.createdAt)],
              }),
              transaction.query.rateCards.findMany({
                where: eq(rateCards.priceBookId, book.id),
                orderBy: [asc(rateCards.sku), asc(rateCards.region)],
              }),
              transaction.query.priceBookSchedules.findFirst({
                where: eq(priceBookSchedules.priceBookId, book.id),
                orderBy: [
                  desc(priceBookSchedules.approvedAt),
                  desc(priceBookSchedules.id),
                ],
              }),
            ]);
            const request = pending[0];
            return {
              ...(schedule
                ? {
                    activationSchedule: {
                      id: schedule.id,
                      status: schedule.status as
                        "approved" | "executed" | "cancelled" | "expired",
                      effectiveFrom: schedule.effectiveFrom,
                      effectiveTo: schedule.effectiveTo,
                      approvedAt: schedule.approvedAt.toISOString(),
                      completedAt: schedule.completedAt?.toISOString() ?? null,
                      completionReason: schedule.completionReason,
                    },
                  }
                : {}),
              id: book.id,
              name: book.name,
              currency: book.currency,
              version: book.version,
              rowVersion: book.rowVersion,
              status: priceBookStatus(book.status),
              effectiveFrom: book.effectiveFrom,
              effectiveTo: book.effectiveTo,
              rateCardCount: book.rateCardCount,
              ...(book.discountMatrix &&
              typeof book.discountMatrix === "object" &&
              Object.keys(book.discountMatrix).length
                ? {
                    discountMatrix:
                      book.discountMatrix as unknown as DiscountMatrix,
                  }
                : {}),
              rateCards: rates.map((rate): RateCard => ({
                id: rate.id,
                sku: rate.sku,
                region: rate.region,
                unit: rate.unit,
                approvedClaim: rate.approvedClaim,
                unitPrice: MoneySchema.parse({
                  currency: book.currency,
                  minor: rate.unitPriceMinor.toString(),
                }),
                ...(rate.floorPriceMinor === null
                  ? {}
                  : {
                      floorPrice: MoneySchema.parse({
                        currency: book.currency,
                        minor: rate.floorPriceMinor.toString(),
                      }),
                    }),
                overageRate: MoneySchema.parse({
                  currency: book.currency,
                  minor: rate.overageRateMinor.toString(),
                }),
                minimumQuantity: rate.minimumQuantity,
                ...(rate.trialLimit === null
                  ? {}
                  : { trialLimit: rate.trialLimit }),
                egressTreatment: rate.egressTreatment,
                commitType: rate.commitType as RateCard["commitType"],
                stripeTaxCode: rate.stripeTaxCode,
                qboIncomeAccount: rate.qboIncomeAccount,
                partnerTransferPrices:
                  rate.partnerTransferPrices as RateCard["partnerTransferPrices"],
              })),
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
      // Parent version/counts, rates and approval evidence must describe one
      // snapshot even if an editor commits between these dependent reads.
      { isolationLevel: "repeatable read" },
    );
  }
}

function priceBookStatus(value: string): "draft" | "active" | "retired" {
  if (value === "draft" || value === "active" || value === "retired")
    return value;
  throw new Error("Price book status is unsupported");
}
