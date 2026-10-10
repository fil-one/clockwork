import { z } from "zod";

import type { Permission } from "./auth";

/**
 * Staff notifications: what Fil One staff are told when a record they work on
 * changes. Every kind lives here once. A kind names the record it is about,
 * the permissions a reader needs to see it (all of them), and whether Slack
 * carries it unless an administrator says otherwise. The events that produce
 * each kind, and who receives it, are mapped in
 * packages/workflows/src/staff-notifications/sources.ts.
 *
 * Adding a kind is one entry here, one source entry there, and its wording in
 * apps/web/src/i18n/messages/operations-notifications.ts.
 */
export const staffNotificationKinds = {
  "mnda.counterparty_signed": { record: "mnda", permissions: ["mnda:send"] },
  "mnda.completed": {
    record: "mnda",
    permissions: ["mnda:send"],
    slack: true,
  },
  "mnda.attention": { record: "mnda", permissions: ["mnda:send"] },
  "mnda.declined": { record: "mnda", permissions: ["mnda:send"] },
  "mnda.expired": { record: "mnda", permissions: ["mnda:send"] },
  "contract.approval_requested": {
    record: "contract",
    permissions: ["contract:read", "contract:approve"],
    slack: true,
  },
  "contract.approved": { record: "contract", permissions: ["contract:read"] },
  "contract.sent_back": { record: "contract", permissions: ["contract:read"] },
  "contract.counterparty_signed": {
    record: "contract",
    permissions: ["contract:read"],
  },
  "contract.executed": {
    record: "contract",
    permissions: ["contract:read"],
    slack: true,
  },
  "contract.attention": { record: "contract", permissions: ["contract:read"] },
  "contract.declined": { record: "contract", permissions: ["contract:read"] },
  "contract.expired": { record: "contract", permissions: ["contract:read"] },
  "handoff.requested": {
    record: "handoff",
    permissions: ["operations:read"],
    slack: true,
  },
  // The requester follows their handoff from the contract record, which a
  // seller can open; the operations queue needs `operations:read`.
  "handoff.in_progress": { record: "contract", permissions: ["contract:read"] },
  "handoff.done": { record: "contract", permissions: ["contract:read"] },
  "handoff.declined": { record: "contract", permissions: ["contract:read"] },
  "capability.approval_requested": {
    record: "capability",
    permissions: ["operations:read"],
  },
  "capability.approved": {
    record: "capability",
    permissions: ["operations:read"],
  },
  "capability.rejected": {
    record: "capability",
    permissions: ["operations:read"],
  },
  "price_book.approval_requested": {
    record: "price_book",
    permissions: ["operations:read", "quote:approve"],
  },
  "price_book.approved": {
    record: "price_book",
    permissions: ["operations:read"],
  },
  "price_book.rejected": {
    record: "price_book",
    permissions: ["operations:read"],
  },
} as const satisfies Record<
  string,
  {
    record: string;
    permissions: readonly [Permission, ...Permission[]];
    slack?: boolean;
  }
>;

export type StaffNotificationKind = keyof typeof staffNotificationKinds;
export const staffNotificationKindList = Object.keys(
  staffNotificationKinds,
) as StaffNotificationKind[];
export const StaffNotificationKindSchema = z.enum(
  staffNotificationKindList as [
    StaffNotificationKind,
    ...StaffNotificationKind[],
  ],
);

export function isStaffNotificationKind(
  value: string,
): value is StaffNotificationKind {
  return Object.hasOwn(staffNotificationKinds, value);
}

/** Slack carries these unless an administrator changes the list. */
export const defaultSlackNotificationKinds = staffNotificationKindList.filter(
  (kind) =>
    (staffNotificationKinds[kind] as { slack?: boolean }).slack === true,
);

/** The groups the settings and preference forms list kinds under. */
export const staffNotificationGroups = [
  "mnda",
  "contract",
  "handoff",
  "capability",
  "price_book",
] as const;
export type StaffNotificationGroup = (typeof staffNotificationGroups)[number];
export const staffNotificationGroup = (kind: StaffNotificationKind) =>
  kind.slice(0, kind.indexOf(".")) as StaffNotificationGroup;

export const staffNotificationChannels = ["email", "slack"] as const;
export type StaffNotificationChannel =
  (typeof staffNotificationChannels)[number];

/** One notification as its recipient reads it. */
export interface StaffNotification {
  id: string;
  kind: StaffNotificationKind;
  recordType: string;
  recordId: string;
  /** A path inside the staff portal. */
  href: string;
  /** The record's name: the counterparty, price book or capability. */
  subject: string;
  /** Who made the change, when a person did. */
  actorName: string | null;
  /** A note the change carried, such as why a contract was sent back. */
  detail: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface StaffNotificationPage {
  notifications: StaffNotification[];
  unread: number;
  /** Older notifications exist beyond this page. */
  more: boolean;
}

export const staffNotificationPageSize = 50;

const kindList = z
  .array(StaffNotificationKindSchema)
  .max(staffNotificationKindList.length)
  .transform((kinds) => [...new Set(kinds)].sort());

/** What a commerce administrator decides for every staff member. */
export const StaffNotificationSettingsSchema = z
  .object({
    emailEnabled: z.boolean(),
    slackEnabled: z.boolean(),
    /** Email carries every kind except these. */
    emailDisabledKinds: kindList,
    /** Slack carries only these. */
    slackKinds: kindList,
    /** Shown on the settings page so staff know where posts land. */
    slackChannelLabel: z
      .string()
      .trim()
      .max(80)
      .refine(
        (value) => [...value].every((c) => c.charCodeAt(0) >= 32),
        "control_character",
      ),
  })
  .strict();
export type StaffNotificationSettings = z.infer<
  typeof StaffNotificationSettingsSchema
>;

export interface StaffNotificationSettingsRecord extends StaffNotificationSettings {
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

/** One person's choices about their own email. */
export const StaffNotificationPreferencesSchema = z
  .object({
    emailEnabled: z.boolean(),
    emailMutedKinds: kindList,
  })
  .strict();
export type StaffNotificationPreferences = z.infer<
  typeof StaffNotificationPreferencesSchema
>;

export const defaultStaffNotificationPreferences: StaffNotificationPreferences =
  { emailEnabled: true, emailMutedKinds: [] };

export const StaffNotificationMarkReadSchema = z
  .object({ ids: z.array(z.uuid()).min(1).max(staffNotificationPageSize) })
  .strict();
