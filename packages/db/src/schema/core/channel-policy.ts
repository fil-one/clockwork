import { sql } from "drizzle-orm";
import {
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

/** Canonical table and guards are installed by migration 001431. */
export const channelPolicyVersions = pgTable(
  "core_channel_policy_versions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuid_v7()`),
    rowVersion: integer("row_version").notNull().default(1),
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
    approvalEvidence: text("approval_evidence"),
    decisionReason: text("decision_reason").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "core_channel_policy_versions_row_version_check",
      sql`${table.rowVersion}>0`,
    ),
    check(
      "core_channel_policy_versions_status_check",
      sql`${table.status} in ('draft','proposed','approved')`,
    ),
    check(
      "channel_policy_terms_check",
      sql`
    jsonb_typeof(${table.terms})='object' and ${table.terms} ?& array['version','effectiveFrom','selfServeThresholdTb','defaultProtectionDays','maximumProtectionDays','extensionDays','maximumExtensions','sourceEvidence']
    and jsonb_typeof(${table.terms}->'version')='number' and ${table.terms}->>'version' ~ '^[0-9]+$'
    and jsonb_typeof(${table.terms}->'selfServeThresholdTb')='number'
    and jsonb_typeof(${table.terms}->'effectiveFrom')='string' and jsonb_typeof(${table.terms}->'sourceEvidence')='string'
    and jsonb_typeof(${table.terms}->'defaultProtectionDays')='number' and ${table.terms}->>'defaultProtectionDays' ~ '^[0-9]+$'
    and jsonb_typeof(${table.terms}->'maximumProtectionDays')='number' and ${table.terms}->>'maximumProtectionDays' ~ '^[0-9]+$'
    and jsonb_typeof(${table.terms}->'extensionDays')='number' and ${table.terms}->>'extensionDays' ~ '^[0-9]+$'
    and jsonb_typeof(${table.terms}->'maximumExtensions')='number' and ${table.terms}->>'maximumExtensions' ~ '^[0-9]+$'
    and (${table.terms}->>'version')::integer>0 and (${table.terms}->>'effectiveFrom') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and (${table.terms}->>'effectiveFrom')::date is not null
    and (${table.terms}->>'selfServeThresholdTb')::numeric>0 and (${table.terms}->>'selfServeThresholdTb')::numeric<=1000000000
    and (${table.terms}->>'defaultProtectionDays')::integer between 1 and 730
    and (${table.terms}->>'maximumProtectionDays')::integer between (${table.terms}->>'defaultProtectionDays')::integer and 730
    and (${table.terms}->>'extensionDays')::integer between 1 and 730
    and (${table.terms}->>'maximumExtensions')::integer between 0 and 10
    and length(trim(${table.terms}->>'sourceEvidence'))>=8
  `,
    ),
    check(
      "channel_policy_approval_check",
      sql`${table.status}<>'approved' or (
    ${table.approvedBy} is not null and ${table.proposedBy} is not null and ${table.approvedBy}<>${table.createdBy} and ${table.approvedBy}<>${table.lastEditedBy}
    and ${table.approvedBy}<>${table.proposedBy} and ${table.approvalEvidence} is not null and length(trim(${table.approvalEvidence}))>=8
  )`,
    ),
    uniqueIndex("core_channel_policy_version_unique").on(
      sql`((${table.terms}->>'version')::integer)`,
    ),
    uniqueIndex("core_channel_policy_effective_unique")
      .on(sql`(${table.terms}->>'effectiveFrom')`)
      .where(sql`${table.status}='approved'`),
  ],
);
