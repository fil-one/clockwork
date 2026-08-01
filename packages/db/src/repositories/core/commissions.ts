import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@clockwork/contracts";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import { commissionAccruals } from "../../schema";
import {
  commissionSettlementExports,
  commissionStatementLines,
  commissionStatements,
  partnerQboVendorMappings,
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

export interface FinalizeCommissionSettlementInput {
  statementId: string;
  partnerAccountId: string;
  expectedRowVersion: number;
  currency: "USD" | "EUR" | "GBP";
  payableMinor: string;
  accrualIds: readonly string[];
  exportKey: string;
  providerBillId?: string;
  actor: Actor;
  requestId: string;
  occurredAt: string;
}

export interface FinalizedCommissionSettlement {
  statementId: string;
  partnerAccountId: string;
  payableMinor: string;
  providerBillId?: string;
  accrualCount: number;
  duplicate?: boolean;
}

export type PersistedQboVendorMappingResult =
  | {
      ok: true;
      value: {
        provider: "qbo";
        partnerAccountId: string;
        vendorId: string;
        mappingVersion: number;
        verifiedAt: string;
        status: "verified";
      };
    }
  | {
      ok: false;
      kind: "permanent";
      code: string;
      message: string;
    };

/** Resolves only a currently verified persisted partner/vendor binding. */
export class DatabaseQboVendorMappingResolver {
  public constructor(private readonly database: RuntimeDatabase) {}

  public async resolve(input: {
    partnerAccountId: string;
  }): Promise<PersistedQboVendorMappingResult> {
    const partnerAccountId = z.uuid().parse(input.partnerAccountId);
    const mapping =
      await this.database.query.partnerQboVendorMappings.findFirst({
        where: eq(partnerQboVendorMappings.partnerAccountId, partnerAccountId),
      });
    if (
      !mapping ||
      mapping.provider !== "qbo" ||
      mapping.verificationStatus !== "verified" ||
      mapping.revokedAt !== null
    )
      return {
        ok: false,
        kind: "permanent",
        code: "QBO_VENDOR_MAPPING_NOT_VERIFIED",
        message: "No verified QBO vendor mapping exists for the partner",
      };
    return {
      ok: true,
      value: {
        provider: "qbo",
        partnerAccountId: mapping.partnerAccountId,
        vendorId: mapping.vendorId,
        mappingVersion: mapping.rowVersion,
        verifiedAt: mapping.verifiedAt.toISOString(),
        status: "verified",
      },
    };
  }
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

  /**
   * Fails closed before any provider effect and durably claims the exact
   * approved statement as exported. A crash can replay the same provider
   * idempotency key, but cannot pair a provider effect with draft local state.
   */
  public validateSettlement(input: {
    statementId: string;
    partnerAccountId: string;
    expectedRowVersion: number;
    currency: "USD" | "EUR" | "GBP";
    payableMinor: string;
    accrualIds: readonly string[];
    exportKey: string;
  }): Promise<{ duplicate?: boolean }> {
    const statementId = z.uuid().parse(input.statementId);
    const partnerAccountId = z.uuid().parse(input.partnerAccountId);
    const currency = CurrencySchema.parse(input.currency);
    const accrualIds = input.accrualIds.map((id) => z.uuid().parse(id)).sort();
    const payableMinor = BigInt(input.payableMinor);
    if (
      !Number.isInteger(input.expectedRowVersion) ||
      input.expectedRowVersion < 1 ||
      !input.exportKey.trim() ||
      payableMinor < 0n ||
      accrualIds.length === 0 ||
      new Set(accrualIds).size !== accrualIds.length
    )
      throw new Error("COMMISSION_SETTLEMENT_BINDING_INVALID");
    return withInternalTransaction(
      this.database,
      `commission-settlement-validate:${statementId}`,
      async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${statementId}, 0))`,
        );
        const statement =
          await transaction.query.commissionStatements.findFirst({
            where: eq(commissionStatements.id, statementId),
          });
        if (
          !statement ||
          statement.partnerAccountId !== partnerAccountId ||
          statement.currency !== currency ||
          statement.payableMinor !== payableMinor
        )
          throw new Error("COMMISSION_STATEMENT_BINDING_MISMATCH");
        const lines = await transaction
          .select({
            accrualId: commissionStatementLines.accrualId,
            partnerAccountId: commissionAccruals.partnerAccountId,
            currency: commissionAccruals.currency,
            status: commissionAccruals.status,
            commissionMinor: commissionStatementLines.commissionMinor,
            holdbackMinor: commissionStatementLines.holdbackMinor,
          })
          .from(commissionStatementLines)
          .innerJoin(
            commissionAccruals,
            eq(commissionAccruals.id, commissionStatementLines.accrualId),
          )
          .where(eq(commissionStatementLines.statementId, statementId));
        const persistedIds = lines.map((line) => line.accrualId).sort();
        if (
          persistedIds.length !== accrualIds.length ||
          persistedIds.some((id, index) => id !== accrualIds[index]) ||
          lines.some(
            (line) =>
              line.partnerAccountId !== partnerAccountId ||
              line.currency !== currency,
          ) ||
          lines.reduce(
            (sum, line) => sum + line.commissionMinor - line.holdbackMinor,
            0n,
          ) !== payableMinor
        )
          throw new Error("COMMISSION_SETTLEMENT_LINE_BINDING_MISMATCH");
        const prior =
          await transaction.query.commissionSettlementExports.findFirst({
            where: eq(commissionSettlementExports.statementId, statementId),
          });
        if (prior) {
          if (prior.exportKey !== input.exportKey)
            throw new Error("COMMISSION_SETTLEMENT_REPLAY_CONFLICT");
          if (
            prior.status === "succeeded" &&
            statement.status === "paid" &&
            statement.rowVersion === input.expectedRowVersion + 2 &&
            lines.every((line) => line.status === "paid")
          )
            return { duplicate: true };
          if (
            prior.status === "pending" &&
            prior.providerReference === null &&
            statement.status === "exported" &&
            statement.rowVersion === input.expectedRowVersion + 1 &&
            lines.every((line) => line.status === "stated")
          )
            return {};
          throw new Error("COMMISSION_SETTLEMENT_REPLAY_CONFLICT");
        }
        if (
          statement.status !== "approved" ||
          statement.rowVersion !== input.expectedRowVersion ||
          lines.some((line) => line.status !== "stated")
        )
          throw new Error("COMMISSION_SETTLEMENT_NOT_APPROVED");
        const [claimed] = await transaction
          .update(commissionStatements)
          .set({ status: "exported" })
          .where(
            and(
              eq(commissionStatements.id, statementId),
              eq(commissionStatements.rowVersion, input.expectedRowVersion),
              eq(commissionStatements.status, "approved"),
            ),
          )
          .returning({ rowVersion: commissionStatements.rowVersion });
        if (!claimed || claimed.rowVersion !== input.expectedRowVersion + 1)
          throw new Error("COMMISSION_SETTLEMENT_CLAIM_CONFLICT");
        await transaction.insert(commissionSettlementExports).values({
          statementId,
          exportKey: input.exportKey,
          format: "qbo_bill",
          status: "pending",
        });
        return {};
      },
    );
  }

  /**
   * Commits the exact provider-accepted statement line set, its accrual state,
   * and the audit/outbox evidence in one transaction. The provider call occurs
   * before this method with `exportKey` as its idempotency key, so a crash is
   * recovered by replaying the same provider operation and then this commit.
   */
  public finalizeSettlement(
    input: FinalizeCommissionSettlementInput,
  ): Promise<FinalizedCommissionSettlement> {
    const statementId = z.uuid().parse(input.statementId);
    const partnerAccountId = z.uuid().parse(input.partnerAccountId);
    const currency = CurrencySchema.parse(input.currency);
    const accrualIds = input.accrualIds.map((id) => z.uuid().parse(id)).sort();
    const occurredAt = new Date(input.occurredAt);
    if (!Number.isFinite(occurredAt.valueOf()))
      throw new TypeError("Commission settlement occurredAt is invalid");
    if (
      !Number.isInteger(input.expectedRowVersion) ||
      input.expectedRowVersion < 1
    )
      throw new TypeError("Commission settlement row version is invalid");
    if (!input.exportKey.trim())
      throw new TypeError("Commission settlement export key is required");
    if (
      accrualIds.length === 0 ||
      new Set(accrualIds).size !== accrualIds.length
    )
      throw new TypeError("Commission settlement accrual IDs must be unique");
    const payableMinor = BigInt(input.payableMinor);
    if (payableMinor < 0n)
      throw new Error("NEGATIVE_COMMISSION_PAYABLE_REQUIRES_CARRY_FORWARD");
    if (payableMinor > 0n && !input.providerBillId?.trim())
      throw new Error("COMMISSION_PROVIDER_BILL_REQUIRED");
    if (payableMinor === 0n && input.providerBillId !== undefined)
      throw new Error("ZERO_COMMISSION_SETTLEMENT_CANNOT_HAVE_PROVIDER_BILL");

    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        // Serialize settlement/replay for this statement without relying on an
        // application-process mutex.
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${statementId}, 0))`,
        );
        const statement =
          await transaction.query.commissionStatements.findFirst({
            where: eq(commissionStatements.id, statementId),
          });
        if (!statement) throw new Error("COMMISSION_STATEMENT_NOT_FOUND");
        if (
          statement.partnerAccountId !== partnerAccountId ||
          statement.currency !== currency
        )
          throw new Error("COMMISSION_STATEMENT_PARTNER_OR_CURRENCY_MISMATCH");
        if (statement.payableMinor !== payableMinor)
          throw new Error("COMMISSION_STATEMENT_PAYABLE_MISMATCH");

        const prior =
          await transaction.query.commissionSettlementExports.findFirst({
            where: eq(commissionSettlementExports.statementId, statementId),
          });
        if (!prior) throw new Error("COMMISSION_SETTLEMENT_CLAIM_NOT_FOUND");
        if (prior.exportKey !== input.exportKey || prior.format !== "qbo_bill")
          throw new Error("COMMISSION_SETTLEMENT_IDEMPOTENCY_CONFLICT");
        if (prior.status === "succeeded") {
          const priorAccrualIds = (
            await transaction.query.commissionStatementLines.findMany({
              where: eq(commissionStatementLines.statementId, statementId),
            })
          )
            .map((line) => line.accrualId)
            .sort();
          if (
            prior.statementId !== statementId ||
            prior.providerReference !== (input.providerBillId ?? "net-zero") ||
            statement.status !== "paid" ||
            statement.rowVersion !== input.expectedRowVersion + 2 ||
            priorAccrualIds.length !== accrualIds.length ||
            priorAccrualIds.some((id, index) => id !== accrualIds[index])
          )
            throw new Error("COMMISSION_SETTLEMENT_IDEMPOTENCY_CONFLICT");
          return {
            statementId,
            partnerAccountId,
            payableMinor: payableMinor.toString(),
            ...(input.providerBillId === undefined
              ? {}
              : { providerBillId: input.providerBillId }),
            accrualCount: accrualIds.length,
            duplicate: true,
          };
        }
        if (
          prior.status !== "pending" ||
          prior.providerReference !== null ||
          statement.status !== "exported" ||
          statement.rowVersion !== input.expectedRowVersion + 1
        )
          throw new Error("COMMISSION_SETTLEMENT_CLAIM_CONFLICT");

        const lines = await transaction
          .select({
            accrualId: commissionStatementLines.accrualId,
            partnerAccountId: commissionAccruals.partnerAccountId,
            currency: commissionAccruals.currency,
            status: commissionAccruals.status,
            commissionMinor: commissionStatementLines.commissionMinor,
            holdbackMinor: commissionStatementLines.holdbackMinor,
          })
          .from(commissionStatementLines)
          .innerJoin(
            commissionAccruals,
            eq(commissionAccruals.id, commissionStatementLines.accrualId),
          )
          .where(eq(commissionStatementLines.statementId, statementId));
        const persistedIds = lines.map((line) => line.accrualId).sort();
        if (
          persistedIds.length !== accrualIds.length ||
          persistedIds.some((id, index) => id !== accrualIds[index])
        )
          throw new Error("COMMISSION_SETTLEMENT_LINE_SET_MISMATCH");
        if (
          lines.some(
            (line) =>
              line.partnerAccountId !== partnerAccountId ||
              line.currency !== currency ||
              line.status !== "stated",
          )
        )
          throw new Error("COMMISSION_SETTLEMENT_LINE_STATE_MISMATCH");
        const calculatedPayable = lines.reduce(
          (sum, line) => sum + line.commissionMinor - line.holdbackMinor,
          0n,
        );
        if (calculatedPayable !== payableMinor)
          throw new Error("COMMISSION_SETTLEMENT_LINE_TOTAL_MISMATCH");

        const [completedExport] = await transaction
          .update(commissionSettlementExports)
          .set({
            status: "succeeded",
            providerReference: input.providerBillId ?? "net-zero",
          })
          .where(
            and(
              eq(commissionSettlementExports.id, prior.id),
              eq(commissionSettlementExports.rowVersion, prior.rowVersion),
              eq(commissionSettlementExports.status, "pending"),
            ),
          )
          .returning({ id: commissionSettlementExports.id });
        if (!completedExport)
          throw new Error("COMMISSION_SETTLEMENT_EXPORT_CONFLICT");
        const paidAccruals = await transaction
          .update(commissionAccruals)
          .set({ status: "paid" })
          .where(
            and(
              inArray(commissionAccruals.id, accrualIds),
              eq(commissionAccruals.partnerAccountId, partnerAccountId),
              eq(commissionAccruals.status, "stated"),
            ),
          )
          .returning({ id: commissionAccruals.id });
        if (paidAccruals.length !== accrualIds.length)
          throw new Error("COMMISSION_SETTLEMENT_ACCRUAL_CONFLICT");
        const [settled] = await transaction
          .update(commissionStatements)
          .set({ status: "paid" })
          .where(
            and(
              eq(commissionStatements.id, statementId),
              eq(commissionStatements.rowVersion, input.expectedRowVersion + 1),
              eq(commissionStatements.status, "exported"),
            ),
          )
          .returning();
        if (!settled)
          throw new Error("COMMISSION_SETTLEMENT_STATEMENT_CONFLICT");
        await appendAuditAndOutbox(transaction, {
          accountId: partnerAccountId,
          aggregateType: "report_export",
          aggregateId: statementId,
          aggregateVersion: settled.rowVersion,
          eventType: "core.commission_statement.settled",
          actor: input.actor,
          requestId: input.requestId,
          occurredAt,
          after: {
            partnerAccountId,
            currency,
            payableMinor: payableMinor.toString(),
            providerBillId: input.providerBillId ?? null,
            exportKey: input.exportKey,
            accrualIds,
          },
        });
        return {
          statementId,
          partnerAccountId,
          payableMinor: payableMinor.toString(),
          ...(input.providerBillId === undefined
            ? {}
            : { providerBillId: input.providerBillId }),
          accrualCount: accrualIds.length,
        };
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
