import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { auditEvents, commerceUsers } from "../schema";

/** Mirrors supabase/migrations/001469_staff_notifications.sql. */
export const staffNotifications = pgTable(
  "commerce_staff_notifications",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_v7()`),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => commerceUsers.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => auditEvents.id),
    kind: text("kind").notNull(),
    recordType: text("record_type").notNull(),
    recordId: text("record_id").notNull(),
    href: text("href").notNull(),
    subject: text("subject").notNull(),
    actorName: text("actor_name"),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    unique("commerce_staff_notifications_event_recipient_unique").on(
      t.eventId,
      t.recipientUserId,
    ),
    index("commerce_staff_notifications_inbox").on(
      t.recipientUserId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index("commerce_staff_notifications_unread")
      .on(t.recipientUserId)
      .where(sql`${t.readAt} is null`),
  ],
);

export const staffNotificationDeliveries = pgTable(
  "commerce_staff_notification_deliveries",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_v7()`),
    eventId: uuid("event_id")
      .notNull()
      .references(() => auditEvents.id),
    channel: text("channel").$type<"email" | "slack">().notNull(),
    recipientUserId: uuid("recipient_user_id").references(
      () => commerceUsers.id,
    ),
    kind: text("kind").notNull(),
    status: text("status")
      .$type<"sending" | "sent" | "skipped" | "failed">()
      .notNull(),
    reason: text("reason"),
    attempts: integer("attempts").notNull().default(1),
    providerMessageId: text("provider_message_id"),
    providerCode: text("provider_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("commerce_staff_notification_deliveries_unique")
      .on(t.eventId, t.channel, t.recipientUserId)
      .nullsNotDistinct(),
    index("commerce_staff_notification_deliveries_recent").on(
      t.updatedAt.desc(),
    ),
    index("commerce_staff_notification_deliveries_retry")
      .on(t.updatedAt)
      .where(
        sql`${t.status} = 'failed' and ${t.reason} = 'provider_unavailable'`,
      ),
  ],
);

export const staffNotificationSettings = pgTable(
  "commerce_staff_notification_settings",
  {
    singleton: boolean("singleton").primaryKey().default(true),
    emailEnabled: boolean("email_enabled").notNull().default(false),
    slackEnabled: boolean("slack_enabled").notNull().default(false),
    emailDisabledKinds: text("email_disabled_kinds")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    slackKinds: text("slack_kinds").array().notNull(),
    slackChannelLabel: text("slack_channel_label").notNull().default(""),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: uuid("updated_by"),
  },
);

export const staffNotificationPreferences = pgTable(
  "commerce_staff_notification_preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => commerceUsers.id),
    emailEnabled: boolean("email_enabled").notNull().default(true),
    emailMutedKinds: text("email_muted_kinds")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const staffNotificationsSchema = {
  staffNotifications,
  staffNotificationDeliveries,
  staffNotificationSettings,
  staffNotificationPreferences,
};
