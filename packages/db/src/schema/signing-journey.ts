import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import type {
  SigningJourneyKind,
  SigningMailPurpose,
} from "@clockwork/contracts";

export const signingRecipients = pgTable(
  "commerce_signing_recipients",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").$type<SigningJourneyKind>().notNull(),
    requestId: uuid("request_id").notNull(),
    providerId: text("provider_id").notNull(),
    slot: text("slot").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    nonce: uuid("nonce").notNull(),
    title: text("title").notNull(),
    testMode: boolean("test_mode").notNull(),
    nextToSign: boolean("next_to_sign").notNull().default(false),
    signed: boolean("signed").notNull().default(false),
    revoked: boolean("revoked").notNull().default(false),
    providerReadAt: timestamp("provider_read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("commerce_signing_recipient_slot").on(t.providerId, t.slot),
    index("commerce_signing_recipient_request").on(t.kind, t.requestId),
  ],
);

export const signingMail = pgTable(
  "commerce_signing_mail",
  {
    id: uuid("id").primaryKey(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => signingRecipients.id),
    recipientNonce: uuid("recipient_nonce").notNull(),
    purpose: text("purpose").$type<SigningMailPurpose>().notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    state: text("state")
      .$type<"pending" | "sending" | "sent" | "skipped" | "failed">()
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    providerCode: text("provider_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("commerce_signing_mail_due").on(t.state, t.availableAt)],
);

export const signingJourneySchema = { signingRecipients, signingMail };
