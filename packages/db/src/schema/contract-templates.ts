import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  ContractTemplateStatus,
  ContractType,
} from "@clockwork/contracts";

/** Mirrors supabase/migrations/001475_contract_template_store.sql. */
export const contractTemplates = pgTable(
  "commerce_contract_templates",
  {
    id: uuid("id").primaryKey(),
    templateKey: text("template_key").notNull(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    contractType: text("contract_type").$type<ContractType>().notNull(),
    requiresApproval: boolean("requires_approval").notNull(),
    fields: jsonb("fields").$type<unknown>().notNull(),
    sections: jsonb("sections").$type<unknown>().notNull().default([]),
    derived: jsonb("derived").$type<unknown>().notNull().default([]),
    document: jsonb("document").$type<unknown>().notNull(),
    contentHash: text("content_hash").notNull(),
    sourceNote: text("source_note").notNull().default(""),
    status: text("status")
      .$type<ContractTemplateStatus>()
      .notNull()
      .default("draft"),
    createdById: uuid("created_by_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    activatedById: uuid("activated_by_id"),
    activatedByName: text("activated_by_name"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    retiredByName: text("retired_by_name"),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    revision: integer("revision").notNull().default(1),
  },
  (t) => [
    unique().on(t.templateKey, t.version),
    uniqueIndex("commerce_contract_templates_one_active")
      .on(t.templateKey)
      .where(sql`status = 'active'`),
    index("commerce_contract_templates_listing").on(
      t.templateKey,
      t.version.desc(),
    ),
  ],
);

export const contractTemplatesSchema = { contractTemplates };
