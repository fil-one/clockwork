import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { commerceUsers } from "../../schema";

/** References and operator attestations only; credential values never belong here. */
export const providerConnectionReferences = pgTable(
  "system_provider_connection_references",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuid_v7()`),
    provider: text("provider").notNull(),
    secretReference: text("secret_reference").notNull(),
    secretVersion: text("secret_version").notNull(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }).notNull(),
    owner: text("owner").notNull(),
    reviewIntervalDays: integer("review_interval_days").notNull(),
    sourceEvidence: text("source_evidence").notNull(),
    rowVersion: integer("row_version").notNull().default(1),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => commerceUsers.id),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("system_provider_connection_references_provider_unique").on(
      table.provider,
    ),
    check(
      "system_provider_connection_references_provider_check",
      sql`${table.provider} in ('billing','accounting','notifications','usage','workos','evidence','provisioning','screening','signature','tax','crm','document_renderer')`,
    ),
    check(
      "system_provider_connection_references_version_check",
      sql`${table.rowVersion} > 0`,
    ),
    check(
      "system_provider_connection_references_interval_check",
      sql`${table.reviewIntervalDays} between 1 and 730`,
    ),
    check(
      "system_provider_connection_references_reference_check",
      sql`${table.secretReference} ~ '^(secret|vault|arn):[A-Za-z0-9_./:-]+$' and length(${table.secretReference}) <= 1000`,
    ),
    check(
      "system_provider_connection_references_text_check",
      sql`length(trim(${table.owner})) between 1 and 200 and length(trim(${table.secretVersion})) between 1 and 200 and length(trim(${table.sourceEvidence})) between 1 and 1000`,
    ),
  ],
);
