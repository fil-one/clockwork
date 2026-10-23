import { sql } from "drizzle-orm";
import {
  bigint,
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

import type {
  AccountDocumentKind,
  HubSpotConnectionStatus,
  HubSpotHandoffPlan,
  HubSpotImportStatus,
  HubSpotItemStatus,
  HubSpotScope,
  HubSpotSourceSnapshot,
} from "@clockwork/contracts";

import { accounts } from "../schema";
import { accountDocuments } from "./account-documents";
import { commercePartners } from "./partners";

/** Mirrors 001483. */
export const commerceHubSpotConnections = pgTable(
  "commerce_hubspot_connections",
  {
    id: uuid("id").primaryKey(),
    portalId: text("portal_id").notNull(),
    uiDomain: text("ui_domain").notNull(),
    status: text("status").$type<HubSpotConnectionStatus>().notNull(),
    audience: text("audience").$type<"staff_sales_read">().notNull(),
    approvedById: uuid("approved_by_id").notNull(),
    approvedByName: text("approved_by_name").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
    scope: jsonb("scope").$type<HubSpotScope>().notNull(),
    defaultPipelineId: text("default_pipeline_id"),
    ownerMappings: jsonb("owner_mappings")
      .$type<{ hubspotOwnerId: string; staffId: string; staffName: string }[]>()
      .notNull()
      .default([]),
    disconnectedByName: text("disconnected_by_name"),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    version: integer("version").notNull().default(1),
  },
  () => [
    uniqueIndex("commerce_hubspot_connections_one_active")
      .on(sql`(true)`)
      .where(sql`status = 'active'`),
  ],
);

export const commerceExternalLinks = pgTable(
  "commerce_external_links",
  {
    id: uuid("id").primaryKey(),
    provider: text("provider").$type<"hubspot">().notNull(),
    portalId: text("portal_id").notNull(),
    objectType: text("object_type").$type<"company">().notNull(),
    objectId: text("object_id").notNull(),
    destinationType: text("destination_type")
      .$type<"partner" | "account">()
      .notNull(),
    partnerId: uuid("partner_id").references(() => commercePartners.id),
    accountId: uuid("account_id").references(() => accounts.id),
    companyName: text("company_name").notNull(),
    createdById: uuid("created_by_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("commerce_external_links_source").on(
      t.provider,
      t.portalId,
      t.objectType,
      t.objectId,
      t.destinationType,
    ),
    uniqueIndex("commerce_external_links_partner")
      .on(t.provider, t.portalId, t.partnerId)
      .where(sql`${t.partnerId} is not null`),
    index("commerce_external_links_partner_lookup")
      .on(t.partnerId)
      .where(sql`${t.partnerId} is not null`),
  ],
);

export const commerceHubSpotImports = pgTable(
  "commerce_hubspot_imports",
  {
    id: uuid("id").primaryKey(),
    linkId: uuid("link_id")
      .notNull()
      .references(() => commerceExternalLinks.id),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => commercePartners.id),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => commerceHubSpotConnections.id),
    portalId: text("portal_id").notNull(),
    companyId: text("company_id").notNull(),
    dealId: text("deal_id"),
    createdPartner: boolean("created_partner").notNull(),
    status: text("status").$type<HubSpotImportStatus>().notNull(),
    plan: jsonb("plan").$type<HubSpotHandoffPlan>().notNull(),
    snapshot: jsonb("snapshot").$type<HubSpotSourceSnapshot>().notNull(),
    requestDigest: text("request_digest").notNull(),
    createdById: uuid("created_by_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("commerce_hubspot_imports_partner").on(
      t.partnerId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
  ],
);

export const commerceHubSpotImportItems = pgTable(
  "commerce_hubspot_import_items",
  {
    id: uuid("id").primaryKey(),
    importId: uuid("import_id")
      .notNull()
      .references(() => commerceHubSpotImports.id),
    fileId: text("file_id").notNull(),
    noteId: text("note_id").notNull(),
    fileName: text("file_name").notNull(),
    title: text("title").notNull(),
    documentKind: text("document_kind").$type<AccountDocumentKind>().notNull(),
    fileUpdatedAt: text("file_updated_at"),
    fileSize: bigint("file_size", { mode: "number" }),
    status: text("status")
      .$type<HubSpotItemStatus>()
      .notNull()
      .default("pending"),
    errorCode: text("error_code"),
    attachmentId: uuid("attachment_id").references(() => accountDocuments.id),
    existingAttachmentId: uuid("existing_attachment_id").references(
      () => accountDocuments.id,
    ),
    excludedReason: text("excluded_reason"),
    resolvedByName: text("resolved_by_name"),
    attempts: integer("attempts").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    unique("commerce_hubspot_import_items_file").on(t.importId, t.fileId),
  ],
);

export const hubspotSchema = {
  commerceHubSpotConnections,
  commerceExternalLinks,
  commerceHubSpotImports,
  commerceHubSpotImportItems,
};
