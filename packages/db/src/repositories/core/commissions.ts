import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@clockwork/contracts";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import { commissionAccruals } from "../../schema";
import {
  commissionStatementLines,
  commissionStatements,
} from "../../schema/core/finance";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";

const QuarterSchema = z.string().regex(/^\d{4}-Q[1-4]$/);
const CurrencySchema = z.enum(["USD", "EUR", "GBP"]);

export interface GenerateCommissionStatementInput {
  statementId: string;
  partnerAccountId: string;
  quarter: string;
  currency: "USD" | "EUR" | "GBP";
  actor: Actor;
  requestId: string;
  occurredAt: string;
}

export interface GeneratedCommissionStatement {
  statementId: string;
  partnerAccountId: string;
  quarter: string;
  currency: "USD" | "EUR" | "GBP";
  grossAccruedMinor: string;
  clawbackMinor: string;
  holdbackMinor: string;
  payableMinor: string;
  lineCount: number;
  duplicate?: boolean;
}

function quarterDates(quarter: string): {
  startsOn: string;
  endsOn: string;
} {
  const parsed = QuarterSchema.parse(quarter);
  const year = Number(parsed.slice(0, 4));
  const quarterIndex = Number(parsed.at(-1)) - 1;
  const startMonth = quarterIndex * 3;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + 3, 0));
  return {
    startsOn: start.toISOString().slice(0, 10),
    endsOn: end.toISOString().slice(0, 10),
  };
}

function result(
  statement: typeof commissionStatements.$inferSelect,
  lineCount: number,
  duplicate = false,
): GeneratedCommissionStatement {
  const month = Number(statement.periodStartsOn.slice(5, 7));
  return {
    statementId: statement.id,
    partnerAccountId: statement.partnerAccountId,
    quarter: `${statement.periodStartsOn.slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`,
    currency: CurrencySchema.parse(statement.currency),
    grossAccruedMinor: statement.grossAccruedMinor.toString(),
    clawbackMinor: statement.clawbackMinor.toString(),
    holdbackMinor: statement.holdbackMinor.toString(),
    payableMinor: statement.payableMinor.toString(),
    lineCount,
    ...(duplicate ? { duplicate: true } : {}),
  };
}

/** Builds one persisted quarterly statement from unstated immutable accruals. */
export class DatabaseCommissionStatementRepository {
  public constructor(private readonly database: RuntimeDatabase) {}

  public generate(
    input: GenerateCommissionStatementInput,
  ): Promise<GeneratedCommissionStatement> {
    const statementId = z.uuid().parse(input.statementId);
    const partnerAccountId = z.uuid().parse(input.partnerAccountId);
    const currency = CurrencySchema.parse(input.currency);
    const quarter = QuarterSchema.parse(input.quarter);
    const dates = quarterDates(quarter);
    const occurredAt = new Date(input.occurredAt);
    if (!Number.isFinite(occurredAt.valueOf()))
      throw new TypeError("Commission statement occurredAt is invalid");
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const prior = await statementByPeriod(transaction, {
          partnerAccountId,
          currency,
          ...dates,
        });
        if (prior) {
          const lines =
            await transaction.query.commissionStatementLines.findMany({
              where: eq(commissionStatementLines.statementId, prior.id),
            });
          return result(prior, lines.length, true);
        }

        const accruals = await transaction.query.commissionAccruals.findMany({
          where: and(
            eq(commissionAccruals.partnerAccountId, partnerAccountId),
            eq(commissionAccruals.period, quarter),
            eq(commissionAccruals.currency, currency),
            eq(commissionAccruals.status, "accrued"),
          ),
          orderBy: [
            asc(commissionAccruals.createdAt),
            asc(commissionAccruals.id),
          ],
        });
        if (accruals.length === 0)
          throw new Error("NO_ELIGIBLE_COMMISSION_ACCRUALS");

        const grossAccruedMinor = accruals.reduce(
          (sum, accrual) =>
            sum + (accrual.amountMinor > 0n ? accrual.amountMinor : 0n),
          0n,
        );
        const clawbackMinor = accruals.reduce(
          (sum, accrual) =>
            sum + (accrual.amountMinor < 0n ? -accrual.amountMinor : 0n),
          0n,
        );
        const holdbackMinor = accruals.reduce(
          (sum, accrual) => sum + accrual.holdbackMinor,
          0n,
        );
        const payableMinor = grossAccruedMinor - clawbackMinor - holdbackMinor;
        const [statement] = await transaction
          .insert(commissionStatements)
          .values({
            id: statementId,
            partnerAccountId,
            periodStartsOn: dates.startsOn,
            periodEndsOn: dates.endsOn,
            currency,
            grossAccruedMinor,
            clawbackMinor,
            holdbackMinor,
            payableMinor,
            status: "draft",
          })
          .onConflictDoNothing()
          .returning();
        if (!statement) {
          const concurrent = await statementByPeriod(transaction, {
            partnerAccountId,
            currency,
            ...dates,
          });
          if (!concurrent)
            throw new Error("COMMISSION_STATEMENT_CONCURRENT_CONFLICT");
          const concurrentLines =
            await transaction.query.commissionStatementLines.findMany({
              where: eq(commissionStatementLines.statementId, concurrent.id),
            });
          return result(concurrent, concurrentLines.length, true);
        }
        await transaction.insert(commissionStatementLines).values(
          accruals.map((accrual) => ({
            statementId: statement.id,
            accrualId: accrual.id,
            sourceType: accrual.sourceType,
            sourceId: accrual.sourceId,
            netCollectedRevenueMinor: accrual.netCollectedRevenueMinor,
            commissionMinor: accrual.amountMinor,
            holdbackMinor: accrual.holdbackMinor,
          })),
        );
        const updated = await transaction
          .update(commissionAccruals)
          .set({ status: "stated" })
          .where(
            and(
              inArray(
                commissionAccruals.id,
                accruals.map((accrual) => accrual.id),
              ),
              eq(commissionAccruals.status, "accrued"),
            ),
          )
          .returning({ id: commissionAccruals.id });
        if (updated.length !== accruals.length)
          throw new Error("COMMISSION_ACCRUAL_STATEMENT_CONFLICT");
        await appendAuditAndOutbox(transaction, {
          accountId: partnerAccountId,
          aggregateType: "report_export",
          aggregateId: statement.id,
          aggregateVersion: statement.rowVersion,
          eventType: "core.commission_statement.generated",
          actor: input.actor,
          requestId: input.requestId,
          occurredAt,
          after: {
            partnerAccountId,
            quarter,
            currency,
            grossAccruedMinor: grossAccruedMinor.toString(),
            clawbackMinor: clawbackMinor.toString(),
            holdbackMinor: holdbackMinor.toString(),
            payableMinor: payableMinor.toString(),
            accrualIds: accruals.map((accrual) => accrual.id),
          },
        });
        return result(statement, accruals.length);
      },
    );
  }
}

function statementByPeriod(
  transaction: RuntimeTransaction,
  input: {
    partnerAccountId: string;
    startsOn: string;
    endsOn: string;
    currency: string;
  },
) {
  return transaction.query.commissionStatements.findFirst({
    where: and(
      eq(commissionStatements.partnerAccountId, input.partnerAccountId),
      eq(commissionStatements.periodStartsOn, input.startsOn),
      eq(commissionStatements.periodEndsOn, input.endsOn),
      eq(commissionStatements.currency, input.currency),
    ),
  });
}
