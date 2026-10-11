import "server-only";

import {
  contextHasPermission,
  staffNotificationPageSize,
  type StaffNotificationKind,
  type StaffNotificationPage,
  type StaffNotificationPreferences,
  type StaffNotificationSettingsRecord,
  defaultStaffNotificationPreferences,
} from "@clockwork/contracts";

import {
  getRequestCommerceSession,
  type CommerceSession,
} from "@/src/auth/session";

import { demoNotificationSettings, demoNotifications } from "./demo";
import {
  NotificationAccessError,
  notificationChannelStatus,
  notificationDemo,
  notificationRepository,
  notificationSettingsPermission,
  notificationStaff,
  readableNotificationKinds,
  type ChannelStatus,
} from "./server";

export type NotificationLoad<T> =
  { kind: "ready"; value: T } | { kind: "forbidden" } | { kind: "unavailable" };

export interface NotificationInboxData {
  page: StaffNotificationPage;
  preferences: StaffNotificationPreferences;
  /** The kinds the reader can be told about, for the preference form. */
  kinds: StaffNotificationKind[];
  email: string;
  /** Email is on in settings and the deployment can send it. */
  emailActive: boolean;
  canManage: boolean;
  demo: boolean;
}

export interface NotificationSettingsData {
  settings: StaffNotificationSettingsRecord;
  channels: { email: ChannelStatus; slack: ChannelStatus };
  recent: {
    channel: "email" | "slack";
    kind: string;
    status: "sending" | "sent" | "skipped" | "failed";
    reason: string | null;
    attempts: number;
    providerCode: string | null;
    updatedAt: string;
  }[];
  adminEmail: string;
  demo: boolean;
}

async function load<T>(read: () => Promise<T>): Promise<NotificationLoad<T>> {
  try {
    return { kind: "ready", value: await read() };
  } catch (error) {
    if (error instanceof NotificationAccessError) return { kind: "forbidden" };
    console.error("Notifications could not be read", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return { kind: "unavailable" };
  }
}

async function demoPage(
  kinds: StaffNotificationKind[],
): Promise<StaffNotificationPage> {
  const notifications = await demoNotifications(kinds);
  return {
    notifications,
    unread: notifications.filter((n) => !n.readAt).length,
    more: false,
  };
}

/** The reader's inbox and email preferences. */
export async function notificationInboxData(
  session: CommerceSession,
): Promise<NotificationInboxData> {
  const kinds = readableNotificationKinds(session);
  const canManage = contextHasPermission(
    session,
    notificationSettingsPermission,
  );
  if (notificationDemo())
    return {
      page: await demoPage(kinds),
      preferences: { ...defaultStaffNotificationPreferences },
      kinds,
      email: session.profile.email,
      emailActive: false,
      canManage,
      demo: true,
    };
  const repository = notificationRepository();
  const [page, preferences, settings] = await Promise.all([
    repository.list(session.userId, kinds, {
      limit: staffNotificationPageSize,
    }),
    repository.preferences(session.userId),
    repository.settings(),
  ]);
  return {
    page,
    preferences,
    kinds,
    email: session.profile.email,
    emailActive:
      settings.emailEnabled &&
      notificationChannelStatus().email.state === "configured",
    canManage,
    demo: false,
  };
}

export function loadNotificationInbox() {
  return load(async () =>
    notificationInboxData(await notificationStaff(getRequestCommerceSession)),
  );
}

/** Unread count for the bell, for a session the caller has checked. */
export async function notificationUnreadCount(
  session: CommerceSession,
): Promise<number> {
  const kinds = readableNotificationKinds(session);
  if (notificationDemo())
    return (await demoNotifications(kinds)).filter((n) => !n.readAt).length;
  return notificationRepository().unreadCount(session.userId, kinds);
}

export async function notificationSettingsData(
  session: CommerceSession,
): Promise<NotificationSettingsData> {
  if (!contextHasPermission(session, notificationSettingsPermission))
    throw new NotificationAccessError("NOTIFICATIONS_FORBIDDEN");
  if (notificationDemo())
    return {
      settings: demoNotificationSettings(),
      channels: { email: { state: "demo" }, slack: { state: "demo" } },
      recent: [],
      adminEmail: session.profile.email,
      demo: true,
    };
  const repository = notificationRepository();
  const [settings, recent] = await Promise.all([
    repository.settings(),
    repository.recentDeliveries(20),
  ]);
  return {
    settings,
    channels: notificationChannelStatus(),
    recent,
    adminEmail: session.profile.email,
    demo: false,
  };
}

export function loadNotificationSettings() {
  return load(async () =>
    notificationSettingsData(
      await notificationStaff(getRequestCommerceSession),
    ),
  );
}
