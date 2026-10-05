import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { auditEvents, commerceUsers, memberships } from "../schema";

/**
 * Generated from packages/contracts/src/auth.ts (migration 001445). Read-only
 * at runtime; the database's stored-role checks join through it.
 */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    role: text("role").notNull(),
    permission: text("permission").notNull(),
  },
  (table) => [primaryKey({ columns: [table.role, table.permission] })],
);

export const organizationSideRoles = pgTable(
  "organization_side_roles",
  {
    side: text("side").notNull(),
    role: text("role").notNull(),
  },
  (table) => [primaryKey({ columns: [table.side, table.role] })],
);

export const organizationSideWithheldPermissions = pgTable(
  "organization_side_withheld_permissions",
  {
    side: text("side").notNull(),
    permission: text("permission").notNull(),
  },
  (table) => [primaryKey({ columns: [table.side, table.permission] })],
);

/** Every role a membership holds, including the primary role. */
export const membershipRoles = pgTable(
  "membership_roles",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_v7()`),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    grantedBy: uuid("granted_by").references(() => commerceUsers.id),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reason: text("reason"),
  },
  (table) => [
    unique("membership_roles_membership_role_unique").on(
      table.membershipId,
      table.role,
    ),
    index("membership_roles_role_idx").on(table.role),
    check(
      "membership_roles_reason_check",
      sql`${table.reason} is null or length(trim(${table.reason})) between 1 and 500`,
    ),
  ],
);

/** Owner-console notices to the other commerce administrators. */
export const staffNotices = pgTable(
  "staff_notices",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_v7()`),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => commerceUsers.id),
    auditEventId: uuid("audit_event_id")
      .notNull()
      .references(() => auditEvents.id),
    eventType: text("event_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    unique("staff_notices_recipient_event_unique").on(
      table.recipientUserId,
      table.auditEventId,
    ),
    index("staff_notices_unread_idx")
      .on(table.recipientUserId, table.createdAt.desc())
      .where(sql`${table.readAt} is null`),
  ],
);

export const accessSchema = {
  rolePermissions,
  organizationSideRoles,
  organizationSideWithheldPermissions,
  membershipRoles,
  staffNotices,
};
