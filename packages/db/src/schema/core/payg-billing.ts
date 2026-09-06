import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts, creditNotes, invoices } from "../../schema";
import { paygOfferVersions } from "./payg-offers";

export const paygEnrollments = pgTable(
  "core_payg_enrollments",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    offerVersionId: uuid("offer_version_id")
      .notNull()
      .references(() => paygOfferVersions.id),
    source: text("source").notNull(),
    sourceEntitlementId: text("source_entitlement_id").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    bindingEvidenceId: text("binding_evidence_id").notNull(),
    cancellationEvidenceId: text("cancellation_evidence_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("core_payg_enrollment_source_unique").on(
      table.source,
      table.sourceEntitlementId,
    ),
  ],
);

export const paygSourceMeasurements = pgTable(
  "core_payg_source_measurements",
  {
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => paygEnrollments.id),
    source: text("source").notNull(),
    sourceMeasurementId: text("source_measurement_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.source, table.sourceMeasurementId] }),
    index("core_payg_source_period_idx").on(table.enrollmentId, table.startsAt),
  ],
);

export const paygSourceReceipts = pgTable(
  "core_payg_source_receipts",
  {
    receiptId: text("receipt_id").primaryKey(),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => paygEnrollments.id),
    payloadHash: text("payload_hash").notNull(),
    verificationEvidenceId: text("verification_evidence_id").notNull(),
    closedThrough: timestamp("closed_through", {
      withTimezone: true,
    }).notNull(),
    completeCountMeters: text("complete_count_meters").array().notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("core_payg_receipt_period_idx").on(
      table.enrollmentId,
      table.closedThrough,
    ),
  ],
);

export const paygPeriodRevisions = pgTable(
  "core_payg_period_revisions",
  {
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => paygEnrollments.id),
    month: text("month").notNull(),
    revision: integer("revision").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.enrollmentId, table.month, table.revision] }),
    check("core_payg_period_revision_positive", sql`${table.revision} > 0`),
  ],
);

export const paygPendingInvoiceEffects = pgTable(
  "core_payg_pending_invoice_effects",
  {
    idempotencyKey: text("idempotency_key").primaryKey(),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => paygEnrollments.id),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const paygInvoiceSources = pgTable("core_payg_invoice_sources", {
  invoiceId: uuid("invoice_id")
    .primaryKey()
    .references(() => invoices.id),
  enrollmentId: uuid("enrollment_id")
    .notNull()
    .references(() => paygEnrollments.id),
  effectKey: text("effect_key")
    .notNull()
    .unique()
    .references(() => paygPendingInvoiceEffects.idempotencyKey),
  sourceSnapshot: jsonb("source_snapshot").notNull(),
  sourceHash: text("source_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const paygCreditSources = pgTable(
  "core_payg_credit_sources",
  {
    creditNoteId: uuid("credit_note_id")
      .primaryKey()
      .references(() => creditNotes.id),
    effectKey: text("effect_key")
      .notNull()
      .references(() => paygPendingInvoiceEffects.idempotencyKey),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    allocationIndex: integer("allocation_index").notNull(),
    netMinor: bigint("net_minor", { mode: "bigint" }).notNull(),
    taxMinor: bigint("tax_minor", { mode: "bigint" }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    sourceSnapshot: jsonb("source_snapshot").notNull(),
    sourceHash: text("source_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("core_payg_credit_effect_allocation_unique").on(
      table.effectKey,
      table.allocationIndex,
    ),
  ],
);
