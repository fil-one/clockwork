import { randomUUID } from "node:crypto";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import {
  PricingScenarioBooksSchema,
  PricingScenarioInputSchema,
  PricingScenarioLinesSchema,
  PricingPartnerEconomicsSchema,
  pricingScenarioListLimit,
  type Actor,
  type PricingScenarioLine,
  type PricingScenarioLineInput,
  type PricingScenarioRecord,
  type PricingScenarioSummary,
} from "@clockwork/contracts";
import {
  convertCapacity,
  indicativeScenarioPrice,
  scenarioPartnerEconomics,
} from "@clockwork/domain/core";
import type { RuntimeDatabase, RuntimeTransaction } from "../client";
import { pricingScenarios } from "../schema/pricing-scenarios";
import { withInternalTransaction } from "../transaction";
import { appendAuditAndOutbox } from "./audit-outbox";
import {
  DatabaseIndicativePriceBookReader,
  type IndicativePriceBookRecord,
} from "./core/indicative-price-books";

type Row = typeof pricingScenarios.$inferSelect;

/**
 * Whose scenarios a caller may reach: a seller their own, a commerce
 * administrator every one. The web layer decides which
 * from the session; the service role does not narrow rows itself.
 */
export type PricingScenarioScope =
  { kind: "own"; ownerId: string } | { kind: "all" };

const view = (row: Row): PricingScenarioRecord => ({
  id: row.id,
  ownerId: row.ownerId,
  ownerName: row.ownerName,
  name: row.name,
  company: row.company,
  notes: row.notes,
  currency: row.currency,
  asOf: row.asOf,
  priceBooks: PricingScenarioBooksSchema.parse(row.priceBooks),
  lines: PricingScenarioLinesSchema.parse(row.lines),
  partnerEconomics:
    row.partnerEconomics === null
      ? null
      : PricingPartnerEconomicsSchema.parse(row.partnerEconomics),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  version: row.version,
});

/**
 * Rows that no longer parse, such as one written by a later version and read
 * after a rollback, are left out of lists rather than failing the page. Only
 * the row id and the error's name are logged.
 */
function readable<T>(rows: readonly Row[], read: (row: Row) => T): T[] {
  return rows.flatMap((row) => {
    try {
      return [read(row)];
    } catch (error) {
      console.error("pricing scenario skipped: it does not parse", {
        id: row.id,
        error: error instanceof Error ? error.name : "unknown",
      });
      return [];
    }
  });
}

const summary = (row: Row): PricingScenarioSummary => {
  const record = view(row);
  return {
    id: record.id,
    ownerId: record.ownerId,
    ownerName: record.ownerName,
    name: record.name,
    company: record.company,
    currency: record.currency,
    asOf: record.asOf,
    updatedAt: record.updatedAt,
    version: record.version,
    lineCount: record.lines.length,
    total: indicativeScenarioPrice(record.lines).total,
  };
};

const inScope = (scope: PricingScenarioScope, row: Row) =>
  scope.kind === "all" || row.ownerId === scope.ownerId;

/**
 * Prices each entered line from the books in force: the list price, unit and
 * minimum come from the book, never from the caller. A quantity entered in
 * another capacity unit is converted exactly to the rate's unit, and the
 * entry is kept beside it for display. A line whose book or rate is no
 * longer in force is refused, as are a unit that does not convert exactly,
 * lines in two currencies and quantities below a rate's minimum.
 */
export function resolvePricingScenarioLines(
  lines: readonly PricingScenarioLineInput[],
  books: readonly IndicativePriceBookRecord[],
): PricingScenarioLine[] {
  const resolved = lines.map((entry): PricingScenarioLine => {
    const book = books.find(({ id }) => id === entry.bookId);
    const rate = book?.rateCards?.find(({ id }) => id === entry.rateId);
    if (!book || !rate) throw new Error("PRICING_SCENARIO_RATE_UNAVAILABLE");
    const rateUnit = rate.unit.replace(/-month$/u, "");
    const converted =
      entry.quantityUnit && entry.quantityUnit !== rateUnit
        ? entry.quantityUnit
        : undefined;
    const quantity = converted
      ? convertCapacity(entry.quantity, converted, rateUnit)
      : entry.quantity;
    if (quantity === null) throw new Error("PRICING_SCENARIO_UNIT_UNSUPPORTED");
    return {
      bookId: book.id,
      bookVersion: book.version,
      rateId: rate.id,
      sku: rate.sku,
      region: rate.region,
      unit: rate.unit,
      unitPrice: rate.unitPrice,
      minimumQuantity: rate.minimumQuantity,
      ...(rate.egressTreatment
        ? { egressTreatment: rate.egressTreatment }
        : {}),
      quantity,
      ...(converted
        ? { entered: { quantity: entry.quantity, unit: converted } }
        : {}),
      termMonths: entry.termMonths,
      discountBps: entry.discountBps,
    };
  });
  const currency = resolved[0]?.unitPrice.currency;
  if (resolved.some((entry) => entry.unitPrice.currency !== currency))
    throw new Error("PRICING_SCENARIO_CURRENCY_MISMATCH");
  const parsed = PricingScenarioLinesSchema.parse(resolved);
  // A quote starts at the rate's minimum, so a summary never shows less.
  if (indicativeScenarioPrice(parsed).lines.some((line) => line.belowMinimum))
    throw new Error("PRICING_SCENARIO_BELOW_MINIMUM");
  return parsed;
}

/** Saved indicative pricing scenarios. Every save and delete is audited. */
export class PricingScenarioRepository {
  constructor(
    private readonly db: RuntimeDatabase,
    private readonly books: Pick<
      DatabaseIndicativePriceBookReader,
      "listInForce"
    > = new DatabaseIndicativePriceBookReader(db),
  ) {}

  private tx<T>(fn: (tx: RuntimeTransaction) => Promise<T>) {
    return withInternalTransaction(this.db, randomUUID(), fn);
  }

  /** Newest first, at most one hundred. */
  list(scope: PricingScenarioScope) {
    const where: SQL | undefined =
      scope.kind === "own"
        ? eq(pricingScenarios.ownerId, scope.ownerId)
        : undefined;
    return this.tx(async (tx) =>
      readable(
        await tx
          .select()
          .from(pricingScenarios)
          .where(where)
          .orderBy(desc(pricingScenarios.updatedAt), desc(pricingScenarios.id))
          .limit(pricingScenarioListLimit),
        summary,
      ),
    );
  }

  /** A scenario outside the caller's scope reads as missing. */
  async get(id: string, scope: PricingScenarioScope) {
    const row = await this.tx(
      async (tx) =>
        (
          await tx
            .select()
            .from(pricingScenarios)
            .where(eq(pricingScenarios.id, id))
        )[0],
    );
    if (!row || !inScope(scope, row))
      throw new Error("PRICING_SCENARIO_NOT_FOUND");
    return view(row);
  }

  /**
   * Saves a new scenario, or overwrites one when `expectedVersion` is given.
   * Lines are priced again from the books in force on `today`, so `asOf`
   * always names the day the saved prices were read. A retried create with
   * the same id returns the stored scenario.
   */
  async save(
    raw: unknown,
    actor: Actor & { kind: "user" },
    scope: PricingScenarioScope,
    today: string,
  ) {
    const input = PricingScenarioInputSchema.parse(raw);
    const lines = resolvePricingScenarioLines(
      input.lines,
      await this.books.listInForce({ today }),
    );
    // A partner cannot earn more than the customer pays in any month.
    if (
      input.partnerEconomics &&
      lines.every((line) => line.unit === lines[0]?.unit) &&
      scenarioPartnerEconomics(lines, input.partnerEconomics).periods.some(
        ({ monthly }) =>
          BigInt(monthly.partnerEarnings.minor) >
          BigInt(monthly.customerSpend.minor),
      )
    )
      throw new Error("PRICING_SCENARIO_PARTNER_ABOVE_SPEND");
    const priceBooks = [
      ...new Map(
        lines.map((line) => [
          line.bookId,
          { id: line.bookId, version: line.bookVersion },
        ]),
      ).values(),
    ];
    const fields = {
      name: input.name,
      company: input.company,
      notes: input.notes,
      currency: lines[0]?.unitPrice.currency ?? "USD",
      asOf: today,
      priceBooks,
      lines,
      partnerEconomics: input.partnerEconomics,
    };
    return this.tx(async (tx) => {
      const [current] = await tx
        .select()
        .from(pricingScenarios)
        .where(eq(pricingScenarios.id, input.id))
        .for("update");
      if (input.expectedVersion === undefined) {
        if (current) {
          if (current.ownerId !== actor.id)
            throw new Error("PRICING_SCENARIO_IDEMPOTENCY_CONFLICT");
          return view(current);
        }
        const [row] = await tx
          .insert(pricingScenarios)
          .values({
            id: input.id,
            ownerId: actor.id,
            ownerName: actor.display ?? actor.id,
            ...fields,
          })
          .returning();
        if (!row) throw new Error("PRICING_SCENARIO_INSERT_FAILED");
        await this.audit(tx, row, actor, "pricing_scenario.created");
        return view(row);
      }
      if (!current || !inScope(scope, current))
        throw new Error("PRICING_SCENARIO_NOT_FOUND");
      if (current.version !== input.expectedVersion)
        throw new Error("PRICING_SCENARIO_VERSION_CONFLICT");
      const [row] = await tx
        .update(pricingScenarios)
        // The database clock, so the list order matches `created_at`.
        .set({ ...fields, updatedAt: sql`now()`, version: current.version + 1 })
        .where(eq(pricingScenarios.id, input.id))
        .returning();
      if (!row) throw new Error("PRICING_SCENARIO_UPDATE_FAILED");
      await this.audit(tx, row, actor, "pricing_scenario.updated");
      return view(row);
    });
  }

  /** Removes a scenario for good; the audit event keeps what it was. */
  delete(
    id: string,
    expectedVersion: number,
    actor: Actor,
    scope: PricingScenarioScope,
  ) {
    return this.tx(async (tx) => {
      const [current] = await tx
        .select()
        .from(pricingScenarios)
        .where(eq(pricingScenarios.id, id))
        .for("update");
      if (!current || !inScope(scope, current))
        throw new Error("PRICING_SCENARIO_NOT_FOUND");
      if (current.version !== expectedVersion)
        throw new Error("PRICING_SCENARIO_VERSION_CONFLICT");
      await tx
        .delete(pricingScenarios)
        .where(
          and(
            eq(pricingScenarios.id, id),
            eq(pricingScenarios.version, expectedVersion),
          ),
        );
      await this.audit(
        tx,
        { ...current, version: current.version + 1 },
        actor,
        "pricing_scenario.deleted",
      );
    });
  }

  /**
   * Records who downloaded a scenario's summary and for which audience, as
   * its own audit aggregate.
   */
  recordDownload(
    actor: Actor,
    scenarioId: string,
    audience: "customer" | "partner" = "customer",
  ) {
    return this.tx((tx) =>
      appendAuditAndOutbox(tx, {
        aggregateType: "document",
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        eventType: "pricing_scenario.downloaded",
        actor,
        requestId: randomUUID(),
        after: { scenarioId, audience },
      }),
    );
  }

  private audit(
    tx: RuntimeTransaction,
    row: Row,
    actor: Actor,
    eventType: string,
  ) {
    return appendAuditAndOutbox(tx, {
      aggregateType: "document",
      aggregateId: row.id,
      aggregateVersion: row.version,
      eventType,
      actor,
      requestId: randomUUID(),
      after: {
        name: row.name,
        company: row.company,
        ownerId: row.ownerId,
        currency: row.currency,
        asOf: row.asOf,
        priceBooks: row.priceBooks,
        lineCount: Array.isArray(row.lines) ? row.lines.length : 0,
        partnerModel:
          row.partnerEconomics === null
            ? null
            : PricingPartnerEconomicsSchema.parse(row.partnerEconomics).model,
      },
    });
  }
}
