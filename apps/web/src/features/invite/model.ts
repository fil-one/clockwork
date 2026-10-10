import type { MessageId } from "@/src/i18n";

/** What the invite page says for each refusal. */
const messages: Readonly<Record<string, MessageId>> = {
  INVITE_NOT_FOUND: "platform.invite.notFound",
  INVITE_EXPIRED: "platform.invite.expired",
  INVITE_ALREADY_ACCEPTED: "platform.invite.used",
  INVITE_ALREADY_MEMBER: "platform.invite.used",
  INVITE_EMAIL_MISMATCH: "platform.invite.wrongEmail",
  INVITE_EMAIL_UNVERIFIED: "platform.invite.unverified",
  INVITE_ORGANIZATION_NOT_READY: "platform.invite.notReady",
  INVITE_IDENTITY_CONFLICT: "platform.invite.conflict",
  INVITE_STAFF_IDENTITY: "platform.invite.conflict",
  INVITE_UNAVAILABLE: "platform.invite.unavailable",
  INVITE_IMPERSONATION_REFUSED: "platform.invite.impersonated",
  SESSION_EXPIRED: "platform.invite.sessionExpired",
};

export function inviteMessage(code: string): MessageId {
  return messages[code] ?? "platform.invite.failed";
}

/** Role labels for the roles an invite can carry. */
export const inviteRoleLabels: Readonly<Record<string, MessageId>> = {
  owner: "role.owner",
  admin: "role.admin",
  billing: "role.billing",
  member: "role.member",
  partner_admin: "role.partnerAdmin",
  partner_seller: "role.partnerSeller",
};

export type AcceptInviteResult = { ok: true } | { ok: false; code: string };
