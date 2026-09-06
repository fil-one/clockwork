import { and, asc, eq, lte } from "drizzle-orm";
import { activatePriceBook } from "@clockwork/domain/core";
import type { RuntimeDatabase } from "../../client";
import { approvals, priceBooks } from "../../schema";
import { priceBookSchedules } from "../../schema/core/price-book-schedules";
import { systemCapabilities } from "../../schema/system";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";
import { serverPriceBook } from "./database-finance";
import {
  assertPersistedPriceScheduleFinance,
  lockPriceBookCurrency,
} from "./price-book-schedule-controls";
import { CoreFinanceRepository } from "./finance";

/** Durable approved rows are the job queue; terminal rows make retries no-ops. */
export class DatabasePriceBookScheduleRepository {
  constructor(
    private readonly db: RuntimeDatabase,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async runDue(now: string) {
    const at = new Date(now);
    if (!Number.isFinite(at.getTime()))
      throw new Error("PRICE_SCHEDULE_TIME_INVALID");
    const day = at.toISOString().slice(0, 10);
    const due = await withInternalTransaction(
      this.db,
      `price-schedules:due:${now}`,
      (tx) =>
        tx
          .select({ id: priceBookSchedules.id })
          .from(priceBookSchedules)
          .where(
            and(
              eq(priceBookSchedules.status, "approved"),
              lte(priceBookSchedules.effectiveFrom, day),
            ),
          )
          .orderBy(
            asc(priceBookSchedules.effectiveFrom),
            asc(priceBookSchedules.id),
          )
          .limit(100),
    );
    const results = [];
    for (const { id } of due) {
      try {
        results.push(await this.execute(id));
      } catch (error) {
        results.push({
          id,
          status: "blocked",
          reason: error instanceof Error ? error.message : "Activation failed",
        });
      }
    }
    return { asOf: at.toISOString(), results };
  }

  async execute(id: string, now?: string) {
    let at = now === undefined ? this.clock() : new Date(now);
    if (!Number.isFinite(at.getTime()))
      throw new Error("PRICE_SCHEDULE_TIME_INVALID");
    let day = at.toISOString().slice(0, 10);
    return withInternalTransaction(
      this.db,
      `price-schedule:${id}:${at.toISOString()}`,
      async (tx) => {
        const initial = await tx.query.priceBookSchedules.findFirst({
          where: eq(priceBookSchedules.id, id),
        });
        if (!initial) throw new Error("PRICE_SCHEDULE_NOT_FOUND");
        await lockPriceBookCurrency(tx, initial.currency);
        const [book] = await tx
          .select()
          .from(priceBooks)
          .where(eq(priceBooks.id, initial.priceBookId))
          .for("update");
        const [schedule] = await tx
          .select()
          .from(priceBookSchedules)
          .where(eq(priceBookSchedules.id, id))
          .for("update");
        if (!schedule || !book) throw new Error("PRICE_SCHEDULE_NOT_FOUND");
        if (schedule.status !== "approved")
          return { id, status: schedule.status, replayed: true };
        // Lock acquisition can cross midnight. Production uses the current
        // clock after waiting; explicit timestamps are a deterministic test seam.
        if (now === undefined) {
          at = this.clock();
          day = at.toISOString().slice(0, 10);
        }
        if (day < schedule.effectiveFrom)
          return { id, status: "not_due", replayed: false };
        let expired =
          schedule.effectiveTo !== null && day > schedule.effectiveTo;
        if (
          book.status !== "draft" ||
          book.rowVersion !== schedule.approvedRowVersion ||
          book.currency !== schedule.currency ||
          book.effectiveFrom !== schedule.effectiveFrom ||
          book.effectiveTo !== schedule.effectiveTo
        )
          throw new Error("PRICE_SCHEDULE_REVIEW_CHANGED");
        if (!expired) {
          // Hold the kill-switch row until the price transition commits.
          const [capability] = await tx
            .select()
            .from(systemCapabilities)
            .where(eq(systemCapabilities.capabilityKey, "new_business"))
            .for("share");
          if (capability?.enabled !== true)
            throw new Error("PRICE_SCHEDULE_NEW_BUSINESS_DISABLED");
          const [decision] = await tx
            .select()
            .from(approvals)
            .where(eq(approvals.id, schedule.approvalId))
            .for("share");
          if (
            !decision ||
            decision.status !== "approved" ||
            decision.action !== "price_book_activation" ||
            decision.objectId !== book.id ||
            decision.approvedBy !== schedule.approvedBy ||
            decision.requestedBy === schedule.approvedBy
          )
            throw new Error("PRICE_SCHEDULE_APPROVAL_CHANGED");
          await assertPersistedPriceScheduleFinance(tx, decision.requestedBy);
          await assertPersistedPriceScheduleFinance(tx, schedule.approvedBy);
        }
        if (now === undefined) {
          at = this.clock();
          day = at.toISOString().slice(0, 10);
          expired ||=
            schedule.effectiveTo !== null && day > schedule.effectiveTo;
        }
        // Unfreeze only inside this atomic execution transaction. Any failure
        // rolls the schedule and every incumbent transition back together.
        const reason = expired
          ? "Approved effective window expired before execution; current pricing retained"
          : "Executed the retained two-person approval at its effective date";
        await tx
          .update(priceBookSchedules)
          .set({
            status: expired ? "expired" : "executed",
            completedAt: at,
            completionReason: reason,
          })
          .where(eq(priceBookSchedules.id, id));
        const repository = new CoreFinanceRepository(tx);
        const requestId = `price-schedule:${id}`;
        const actor = {
          kind: "system" as const,
          id: "price-book-schedule-worker",
        };
        if (expired) {
          const [touched] = await tx
            .update(priceBooks)
            .set({ updatedAt: at })
            .where(eq(priceBooks.id, book.id))
            .returning();
          if (!touched) throw new Error("PRICE_SCHEDULE_BOOK_MISSING");
          await appendAuditAndOutbox(tx, {
            aggregateType: "price_book",
            aggregateId: book.id,
            aggregateVersion: touched.rowVersion,
            eventType: "core.price_books.schedule_expired",
            actor,
            requestId,
            occurredAt: at,
            after: { scheduleId: id, status: "expired", reason },
          });
          await repository.recordPriceBookActivation({
            priceBookId: book.id,
            action: "cancel_schedule",
            previousStatus: "draft",
            resultingStatus: "draft",
            effectiveAt: at,
            actorUserId: schedule.approvedBy,
            reason,
            requestId,
          });
          return { id, status: "expired", replayed: false };
        }
        const headers = await tx.query.priceBooks.findMany({
          where: eq(priceBooks.currency, book.currency),
        });
        const allBooks = await Promise.all(
          headers.map((header) => serverPriceBook(tx, header.id)),
        );
        const candidate = allBooks.find((entry) => entry.id === book.id);
        if (!candidate) throw new Error("PRICE_SCHEDULE_BOOK_MISSING");
        const decision = activatePriceBook({
          candidate,
          allBooks,
          actorId: actor.id,
          occurredAt: at.toISOString(),
        });
        for (const change of decision.audits) {
          const retiring = change.action === "retired";
          const [updated] = await tx
            .update(priceBooks)
            .set({
              status: retiring ? "retired" : "active",
              effectiveTo: retiring ? day : (candidate.effectiveTo ?? null),
            })
            .where(
              and(
                eq(priceBooks.id, change.priceBookId),
                eq(priceBooks.status, change.beforeStatus),
              ),
            )
            .returning();
          if (!updated) throw new Error("PRICE_SCHEDULE_CONCURRENT_CHANGE");
          await repository.recordPriceBookActivation({
            priceBookId: updated.id,
            action: retiring ? "retire" : "activate",
            previousStatus: change.beforeStatus,
            resultingStatus: updated.status,
            effectiveAt: at,
            actorUserId: schedule.approvedBy,
            reason,
            requestId,
          });
          await appendAuditAndOutbox(tx, {
            aggregateType: "price_book",
            aggregateId: updated.id,
            aggregateVersion: updated.rowVersion,
            eventType: retiring
              ? "core.price_books.scheduled_retirement"
              : "core.price_books.scheduled_activation",
            actor,
            requestId,
            occurredAt: at,
            after: {
              scheduleId: id,
              approvalId: schedule.approvalId,
              approvedBy: schedule.approvedBy,
              status: updated.status,
              effectiveFrom: updated.effectiveFrom,
              effectiveTo: updated.effectiveTo,
            },
          });
        }
        return { id, status: "executed", replayed: false };
      },
    );
  }
}
