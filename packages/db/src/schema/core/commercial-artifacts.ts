import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { accounts, commerceUsers, documents } from "../../schema";

export const commercialArtifactRequests = pgTable(
  "core_commercial_artifact_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    commercialAccountId: uuid("commercial_account_id")
      .notNull()
      .references(() => accounts.id),
    audienceAccountId: uuid("audience_account_id")
      .notNull()
      .references(() => accounts.id),
    audience: text("audience").notNull(),
    documentKind: text("document_kind").notNull(),
    sourceDefinition: jsonb("source_definition").notNull(),
    sourceHash: text("source_hash").notNull(),
    requestHash: text("request_hash").notNull(),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("requested"),
    documentId: uuid("document_id").references(() => documents.id),
    contentHash: text("content_hash"),
    storageVersionId: text("storage_version_id"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => commerceUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("core_commercial_artifact_source_unique").on(
      table.subjectType,
      table.subjectId,
      table.documentKind,
      table.sourceHash,
    ),
    index("core_commercial_artifact_dispatch_idx").on(
      table.status,
      table.createdAt,
    ),
    index("core_commercial_artifact_document_idx").on(table.documentId),
    check(
      "core_commercial_artifact_subject_check",
      sql`${table.subjectType} in ('quote','order','amendment')`,
    ),
    check(
      "core_commercial_artifact_audience_check",
      sql`${table.audience} in ('end_client','partner')`,
    ),
    check(
      "core_commercial_artifact_kind_check",
      sql`${table.documentKind} in ('direct_quote','partner_transfer_quote','partner_resale_quote','order_form','amendment')`,
    ),
    check(
      "core_commercial_artifact_hash_check",
      sql`${table.sourceHash} ~ '^[a-f0-9]{64}$' and ${table.requestHash} ~ '^[a-f0-9]{64}$' and (${table.contentHash} is null or ${table.contentHash} ~ '^[a-f0-9]{64}$')`,
    ),
    check(
      "core_commercial_artifact_state_check",
      sql`(${table.status} = 'requested' and ${table.documentId} is null and ${table.contentHash} is null and ${table.storageVersionId} is null) or (${table.status} = 'stored' and ${table.documentId} is not null and ${table.contentHash} is not null and ${table.storageVersionId} is not null)`,
    ),
  ],
);
