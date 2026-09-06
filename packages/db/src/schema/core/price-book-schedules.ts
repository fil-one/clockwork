import { sql } from "drizzle-orm";
import {
  check,
  date,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { approvals, commerceUsers, priceBooks } from "../../schema";

export const priceBookSchedules = pgTable(
  "core_price_book_schedules",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuid_v7()`),
    priceBookId: uuid("price_book_id")
      .notNull()
      .references(() => priceBooks.id),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => approvals.id),
    currency: text("currency").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    approvedRowVersion: integer("approved_row_version").notNull(),
    status: text("status").notNull().default("approved"),
    approvedBy: uuid("approved_by")
      .notNull()
      .references(() => commerceUsers.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completionReason: text("completion_reason"),
    cancelledBy: uuid("cancelled_by").references(() => commerceUsers.id),
  },
  (table) => [
    uniqueIndex("core_price_schedule_approval_unique").on(table.approvalId),
    uniqueIndex("core_price_schedule_pending_currency_unique")
      .on(table.currency)
      .where(sql`${table.status}='approved'`),
    check(
      "core_price_schedule_status_check",
      sql`${table.status} in ('approved','executed','cancelled','expired')`,
    ),
    check(
      "core_price_schedule_window_check",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
    check(
      "core_price_schedule_completion_check",
      sql`(${table.status}='approved' and ${table.completedAt} is null and ${table.completionReason} is null and ${table.cancelledBy} is null) or (${table.status}<>'approved' and ${table.completedAt} is not null and ${table.completionReason} is not null and length(trim(${table.completionReason}))>0 and ((${table.status}='cancelled')=(${table.cancelledBy} is not null)))`,
    ),
  ],
);
