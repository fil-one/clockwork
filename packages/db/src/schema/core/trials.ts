import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts, organizations } from "../../schema";
import { paygOfferVersions } from "./payg-offers";

export const trialClaims = pgTable("core_trial_claims", {
  id: uuid("id").primaryKey(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  organizationId: uuid("organization_id")
    .notNull()
    .unique()
    .references(() => organizations.id),
  verifiedDomain: text("verified_domain").notNull().unique(),
  offerVersionId: uuid("offer_version_id")
    .notNull()
    .references(() => paygOfferVersions.id),
  verificationEvidenceId: text("verification_evidence_id").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const trialCounterReceipts = pgTable("core_trial_counter_receipts", {
  id: text("id").primaryKey(),
  trialId: uuid("trial_id")
    .notNull()
    .references(() => trialClaims.id),
  payload: jsonb("payload").notNull(),
  payloadHash: text("payload_hash").notNull(),
  verificationEvidenceId: text("verification_evidence_id").notNull(),
  counters: jsonb("counters").notNull(),
  measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const trialReservations = pgTable("core_trial_reservations", {
  id: text("id").primaryKey(),
  trialId: uuid("trial_id")
    .notNull()
    .references(() => trialClaims.id),
  operation: jsonb("operation").notNull(),
  authorizedAt: timestamp("authorized_at", { withTimezone: true }).notNull(),
  counterReceiptId: text("counter_receipt_id")
    .notNull()
    .references(() => trialCounterReceipts.id),
});
export const trialReservationSettlements = pgTable(
  "core_trial_reservation_settlements",
  {
    reservationId: text("reservation_id")
      .primaryKey()
      .references(() => trialReservations.id),
    receiptId: text("receipt_id")
      .notNull()
      .references(() => trialCounterReceipts.id),
    outcome: text("outcome").notNull(),
    actualBytes: text("actual_bytes")
      .notNull()
      .default(sql`'0'`),
  },
);
