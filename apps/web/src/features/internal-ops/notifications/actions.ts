"use server";

import { revalidatePath } from "next/cache";

import {
  contextHasPermission,
  StaffNotificationMarkReadSchema,
  type Actor,
} from "@clockwork/contracts";
import { staffNotificationChannels } from "@clockwork/integrations";
import {
  sendStaffNotificationTest,
  staffNotificationOrigin,
} from "@clockwork/workflows/staff-notifications";

import { SessionExpiredError } from "@/src/auth/session";

import { attempt, type ActionResult } from "../contracts/action-result";
import { markDemoNotificationsRead, demoNotificationIds } from "./demo";
import {
  NotificationAccessError,
  notificationDemo,
  notificationRepository,
  notificationSettingsPermission,
  notificationStaff,
  readableNotificationKinds,
  type NotificationSession,
} from "./server";

/** Session expiry is its own code so the page can offer a reload. */
function run<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  return attempt(async () => {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof SessionExpiredError)
        throw new Error("SESSION_EXPIRED");
      throw error;
    }
  });
}

const actor = (session: NotificationSession): Actor => ({
  kind: "user",
  id: session.userId,
  display: session.profile.name,
});

async function administrator() {
  const session = await notificationStaff();
  if (!contextHasPermission(session, notificationSettingsPermission))
    throw new NotificationAccessError("NOTIFICATIONS_FORBIDDEN");
  return session;
}

export async function markNotificationsRead(raw: unknown) {
  return run(async () => {
    const { ids } = StaffNotificationMarkReadSchema.parse(raw);
    const session = await notificationStaff();
    if (notificationDemo()) {
      await markDemoNotificationsRead(ids);
      return { marked: ids.length };
    }
    const marked = await notificationRepository().markRead(session.userId, ids);
    revalidatePath("/internal/notifications");
    return { marked };
  });
}

export async function markAllNotificationsRead() {
  return run(async () => {
    const session = await notificationStaff();
    if (notificationDemo()) {
      await markDemoNotificationsRead(demoNotificationIds());
      return { marked: 0 };
    }
    const marked = await notificationRepository().markAllRead(
      session.userId,
      readableNotificationKinds(session),
    );
    revalidatePath("/internal/notifications");
    return { marked };
  });
}

/** The reader's own email choices. The demo keeps none. */
export async function saveNotificationPreferences(raw: unknown) {
  return run(async () => {
    const session = await notificationStaff();
    if (notificationDemo()) throw new Error("NOTIFICATIONS_DEMO_UNAVAILABLE");
    return notificationRepository().savePreferences(
      session.userId,
      raw,
      actor(session),
    );
  });
}

export async function saveNotificationSettings(
  raw: unknown,
  expectedVersion: number,
) {
  return run(async () => {
    const session = await administrator();
    if (notificationDemo()) throw new Error("NOTIFICATIONS_DEMO_UNAVAILABLE");
    if (!Number.isSafeInteger(expectedVersion))
      throw new Error("INVALID_INPUT");
    const saved = await notificationRepository().saveSettings(
      raw,
      expectedVersion,
      actor(session),
    );
    revalidatePath("/internal/notifications/settings");
    return saved;
  });
}

/**
 * Sends a test on one channel: an email to the administrator's own address,
 * or a post to the configured Slack channel, and records it in the audit
 * trail. The demo never sends.
 */
export async function sendNotificationTest(channel: "email" | "slack") {
  return run(async () => {
    const session = await administrator();
    if (notificationDemo()) throw new Error("NOTIFICATIONS_DEMO_UNAVAILABLE");
    if (channel !== "email" && channel !== "slack")
      throw new Error("INVALID_INPUT");
    const result = await sendStaffNotificationTest(channel, {
      channels: staffNotificationChannels(process.env),
      origin: staffNotificationOrigin(process.env),
      to: session.profile.email,
    });
    const code = result.ok ? null : result.code.slice(0, 80);
    await notificationRepository().recordTest(
      channel,
      { delivered: result.ok, code },
      actor(session),
    );
    if (!result.ok) return { delivered: false as const, code: code ?? "" };
    return { delivered: true as const };
  });
}
