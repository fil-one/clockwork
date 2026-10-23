import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AccountDocumentKind } from "@clockwork/contracts";
import { accounts } from "../schema";
import { commercePartners } from "./partners";

export const accountDocuments = pgTable(
  "commerce_account_documents",
  {
    id: uuid("id").primaryKey(),
    partnerId: uuid("partner_id").references(() => commercePartners.id),
    accountId: uuid("account_id").references(() => accounts.id),
    title: text("title").notNull(),
    kind: text("kind").$type<AccountDocumentKind>().notNull(),
    signedOn: date("signed_on", { mode: "string" }),
    fileName: text("file_name").notNull(),
    storageBackend: text("storage_backend").notNull(),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    contentType: text("content_type").notNull(),
    uploadedById: uuid("uploaded_by_id").notNull(),
    uploadedByName: text("uploaded_by_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // 001484: an audited removal from the record; the row and bytes stay.
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedById: uuid("removed_by_id"),
    removedByName: text("removed_by_name"),
    removalReason: text("removal_reason"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("account_documents_storage").on(t.storageBackend, t.storageKey),
    uniqueIndex("account_documents_partner_hash")
      .on(t.partnerId, t.sha256)
      .where(sql`${t.partnerId} is not null and ${t.removedAt} is null`),
    uniqueIndex("account_documents_account_hash")
      .on(t.accountId, t.sha256)
      .where(sql`${t.accountId} is not null and ${t.removedAt} is null`),
    index("account_documents_partner").on(
      t.partnerId,
      t.createdAt.desc(),
      t.id,
    ),
    index("account_documents_account").on(
      t.accountId,
      t.createdAt.desc(),
      t.id,
    ),
  ],
);
export const accountDocumentsSchema = { accountDocuments };
