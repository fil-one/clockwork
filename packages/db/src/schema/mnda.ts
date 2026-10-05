import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { MndaInput, MndaSigner, MndaState } from "@clockwork/contracts";

export const mndaSigners = pgTable(
  "commerce_mnda_signers",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    title: text("title").notNull(),
    active: boolean("active").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("commerce_mnda_one_default")
      .on(t.isDefault)
      .where(sql`${t.isDefault} = true`),
  ],
);
export const mndaRequests = pgTable("commerce_mnda_requests", {
  id: uuid("id").primaryKey(),
  input: jsonb("input").$type<MndaInput>().notNull(),
  countersigner: jsonb("countersigner").$type<MndaSigner>().notNull(),
  noticeEmail: text("notice_email"),
  ownerId: uuid("owner_id").notNull(),
  ownerName: text("owner_name").notNull(),
  ownerEmail: text("owner_email"),
  correctedSignerEmail: text("corrected_signer_email"),
  state: text("state").$type<MndaState>().notNull().default("draft"),
  providerId: text("provider_id").unique(),
  templateHash: text("template_hash").notNull(),
  testMode: boolean("test_mode").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  remindedAt: timestamp("reminded_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  leaseToken: uuid("lease_token"),
  error: text("error"),
  version: integer("version").notNull().default(1),
});
export const mndaArtifacts = pgTable(
  "commerce_mnda_artifacts",
  {
    id: uuid("id").primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => mndaRequests.id),
    kind: text("kind").$type<"original" | "executed">().notNull(),
    sha256: text("sha256").notNull(),
    base64: text("base64").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("commerce_mnda_artifact_kind").on(t.requestId, t.kind)],
);
/** Single row (`id` is always true): settings that bind new drafts. */
export const mndaSettings = pgTable("commerce_mnda_settings", {
  id: boolean("id").primaryKey().default(true),
  noticeEmail: text("notice_email").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: uuid("updated_by"),
});
export const mndaSchema = {
  mndaSigners,
  mndaRequests,
  mndaArtifacts,
  mndaSettings,
};
