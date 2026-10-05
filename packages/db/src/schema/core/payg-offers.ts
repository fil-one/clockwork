import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { commerceUsers } from "../../schema";

export const paygOfferVersions = pgTable(
  "core_payg_offer_versions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuid_v7()`),
    sku: text("sku").notNull(),
    region: text("region").notNull(),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"),
    terms: jsonb("terms").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => commerceUsers.id),
    lastEditedBy: uuid("last_edited_by")
      .notNull()
      .references(() => commerceUsers.id),
    proposedBy: uuid("proposed_by").references(() => commerceUsers.id),
    approvedBy: uuid("approved_by").references(() => commerceUsers.id),
    approvalEvidenceId: text("approval_evidence_id"),
    decisionReason: text("decision_reason").notNull().default(""),
    /** The approver approved their own version under approval:self (001449). */
    selfApproved: boolean("self_approved").notNull().default(false),
    selfApprovalReason: text("self_approval_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("core_payg_offer_version_unique").on(
      table.sku,
      table.region,
      table.version,
    ),
    check(
      "core_payg_offer_status_check",
      sql`${table.status} in ('draft','proposed','approved','retired')`,
    ),
    check(
      "core_payg_offer_version_check",
      sql`${table.version} > 0 and ${table.rowVersion} > 0`,
    ),
    check(
      "core_payg_offer_approval_check",
      sql`${table.status} not in ('approved','retired') or (${table.approvedBy} is not null and ${table.proposedBy} is not null and ${table.approvalEvidenceId} is not null and length(trim(${table.approvalEvidenceId})) > 0 and (${table.selfApproved} or (${table.approvedBy} <> ${table.proposedBy} and ${table.approvedBy} <> ${table.createdBy} and ${table.approvedBy} <> ${table.lastEditedBy})))`,
    ),
    check(
      "core_payg_offer_self_approval_check",
      sql`(not ${table.selfApproved} and ${table.selfApprovalReason} is null) or (${table.selfApproved} and ${table.status} in ('approved','retired') and ${table.approvedBy} in (${table.createdBy}, ${table.lastEditedBy}, ${table.proposedBy}) and length(trim(${table.selfApprovalReason})) between 8 and 500)`,
    ),
    check(
      "core_payg_offer_terms_binding_check",
      sql`jsonb_typeof(${table.terms}) = 'object' and ${table.terms}->>'sku' is not null and ${table.terms}->>'region' is not null and ${table.terms}->>'version' is not null and ${table.terms}->>'sku' = ${table.sku} and ${table.terms}->>'region' = ${table.region} and (${table.terms}->>'version')::integer = ${table.version}`,
    ),
  ],
);
