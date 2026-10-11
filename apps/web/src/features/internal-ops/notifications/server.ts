import "server-only";

import {
  contextHasPermission,
  staffNotificationKindList,
  staffNotificationKinds,
  type Permission,
  type StaffNotificationKind,
} from "@clockwork/contracts";
import { StaffNotificationRepository } from "@clockwork/db";
import { staffNotificationChannels } from "@clockwork/integrations";

import {
  explicitDemoIdentityEnabled,
  getCommerceSession,
  type CommerceSession,
} from "@/src/auth/session";
import { getServiceDatabase } from "@/src/db/service";

export type NotificationAccessFailure =
  "NOTIFICATIONS_FORBIDDEN" | "NOTIFICATIONS_MFA_REQUIRED";

export class NotificationAccessError extends Error {
  constructor(readonly code: NotificationAccessFailure) {
    super(code);
  }
}

/**
 * Every notification read and write passes through here. The tables are read
 * on the service role, which row security does not narrow, so this is the
 * guard: a Fil One staff session of one's own, with a second factor, not
 * acting inside a customer account. Everyone on the staff team has an inbox;
 * what is in it is narrowed to the kinds the reader may see.
 */
export async function notificationStaff(
  readSession: () => Promise<CommerceSession> = getCommerceSession,
) {
  const session = await readSession();
  if (
    !session.isInternalStaff ||
    session.impersonation ||
    session.assistedSession
  )
    throw new NotificationAccessError("NOTIFICATIONS_FORBIDDEN");
  if (!session.mfaVerified)
    throw new NotificationAccessError("NOTIFICATIONS_MFA_REQUIRED");
  return session;
}

export type NotificationSession = Awaited<ReturnType<typeof notificationStaff>>;

/** Changing who is told what, and how, is for commerce administrators. */
export const notificationSettingsPermission: Permission = "staff:manage";

/** The kinds a session may read: those whose every permission it holds. A
 * notification written before the reader lost a permission stays hidden. */
export function readableNotificationKinds(
  session: Pick<CommerceSession, "roles" | "permissions">,
): StaffNotificationKind[] {
  return staffNotificationKindList.filter((kind) =>
    staffNotificationKinds[kind].permissions.every((permission) =>
      contextHasPermission(session, permission),
    ),
  );
}

export const notificationRepository = () =>
  new StaffNotificationRepository(getServiceDatabase());

export const notificationDemo = () => explicitDemoIdentityEnabled();

/** Whether each channel can send, for the settings page. Never the secret. */
export type ChannelStatus =
  | { state: "configured"; target: string }
  | {
      state: "not_configured" | "invalid_configuration" | "demo";
    };

export function notificationChannelStatus(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { email: ChannelStatus; slack: ChannelStatus } {
  const channels = staffNotificationChannels(env);
  const status = (channel: (typeof channels)["email" | "slack"]) =>
    channel.configured
      ? { state: "configured" as const, target: channel.target }
      : { state: channel.reason };
  return { email: status(channels.email), slack: status(channels.slack) };
}
