import {
  staffNotificationGroup,
  staffNotificationGroups,
  type StaffNotification,
  type StaffNotificationGroup,
  type StaffNotificationKind,
} from "@clockwork/contracts";

import type { MessageId, Translator } from "@/src/i18n";

/** The sentence each kind reads as. A kind without one is a type error. */
export const notificationLineIds = {
  "mnda.counterparty_signed":
    "operations.notifications.kind.mnda.counterparty_signed",
  "mnda.completed": "operations.notifications.kind.mnda.completed",
  "mnda.attention": "operations.notifications.kind.mnda.attention",
  "mnda.declined": "operations.notifications.kind.mnda.declined",
  "mnda.expired": "operations.notifications.kind.mnda.expired",
  "contract.approval_requested":
    "operations.notifications.kind.contract.approval_requested",
  "contract.approved": "operations.notifications.kind.contract.approved",
  "contract.sent_back": "operations.notifications.kind.contract.sent_back",
  "contract.counterparty_signed":
    "operations.notifications.kind.contract.counterparty_signed",
  "contract.executed": "operations.notifications.kind.contract.executed",
  "contract.attention": "operations.notifications.kind.contract.attention",
  "contract.declined": "operations.notifications.kind.contract.declined",
  "contract.expired": "operations.notifications.kind.contract.expired",
  "handoff.requested": "operations.notifications.kind.handoff.requested",
  "handoff.in_progress": "operations.notifications.kind.handoff.in_progress",
  "handoff.done": "operations.notifications.kind.handoff.done",
  "handoff.declined": "operations.notifications.kind.handoff.declined",
  "capability.approval_requested":
    "operations.notifications.kind.capability.approval_requested",
  "capability.approved": "operations.notifications.kind.capability.approved",
  "capability.rejected": "operations.notifications.kind.capability.rejected",
  "price_book.approval_requested":
    "operations.notifications.kind.price_book.approval_requested",
  "price_book.approved": "operations.notifications.kind.price_book.approved",
  "price_book.rejected": "operations.notifications.kind.price_book.rejected",
} as const satisfies Record<StaffNotificationKind, MessageId>;

/** The short name of each kind, for the settings and preference forms. */
export const notificationLabelIds = {
  "mnda.counterparty_signed":
    "operations.notifications.label.mnda.counterparty_signed",
  "mnda.completed": "operations.notifications.label.mnda.completed",
  "mnda.attention": "operations.notifications.label.mnda.attention",
  "mnda.declined": "operations.notifications.label.mnda.declined",
  "mnda.expired": "operations.notifications.label.mnda.expired",
  "contract.approval_requested":
    "operations.notifications.label.contract.approval_requested",
  "contract.approved": "operations.notifications.label.contract.approved",
  "contract.sent_back": "operations.notifications.label.contract.sent_back",
  "contract.counterparty_signed":
    "operations.notifications.label.contract.counterparty_signed",
  "contract.executed": "operations.notifications.label.contract.executed",
  "contract.attention": "operations.notifications.label.contract.attention",
  "contract.declined": "operations.notifications.label.contract.declined",
  "contract.expired": "operations.notifications.label.contract.expired",
  "handoff.requested": "operations.notifications.label.handoff.requested",
  "handoff.in_progress": "operations.notifications.label.handoff.in_progress",
  "handoff.done": "operations.notifications.label.handoff.done",
  "handoff.declined": "operations.notifications.label.handoff.declined",
  "capability.approval_requested":
    "operations.notifications.label.capability.approval_requested",
  "capability.approved": "operations.notifications.label.capability.approved",
  "capability.rejected": "operations.notifications.label.capability.rejected",
  "price_book.approval_requested":
    "operations.notifications.label.price_book.approval_requested",
  "price_book.approved": "operations.notifications.label.price_book.approved",
  "price_book.rejected": "operations.notifications.label.price_book.rejected",
} as const satisfies Record<StaffNotificationKind, MessageId>;

export const notificationGroupIds = {
  mnda: "operations.notifications.group.mnda",
  contract: "operations.notifications.group.contract",
  handoff: "operations.notifications.group.handoff",
  capability: "operations.notifications.group.capability",
  price_book: "operations.notifications.group.price_book",
} as const satisfies Record<StaffNotificationGroup, MessageId>;

export const deliveryStatusIds = {
  sending: "operations.notifications.settings.status.sending",
  sent: "operations.notifications.settings.status.sent",
  skipped: "operations.notifications.settings.status.skipped",
  failed: "operations.notifications.settings.status.failed",
} as const satisfies Record<
  "sending" | "sent" | "skipped" | "failed",
  MessageId
>;

export const deliveryReasonIds: Readonly<Record<string, MessageId>> = {
  not_configured: "operations.notifications.settings.reason.not_configured",
  invalid_configuration:
    "operations.notifications.settings.reason.invalid_configuration",
  channel_off: "operations.notifications.settings.reason.channel_off",
  kind_off: "operations.notifications.settings.reason.kind_off",
  preference_off: "operations.notifications.settings.reason.preference_off",
  no_access: "operations.notifications.settings.reason.no_access",
  demo: "operations.notifications.settings.reason.demo",
  provider_rejected:
    "operations.notifications.settings.reason.provider_rejected",
  provider_unavailable:
    "operations.notifications.settings.reason.provider_unavailable",
  gave_up: "operations.notifications.settings.reason.gave_up",
};

/** A notification as one sentence. */
export function notificationLine(
  notification: Pick<StaffNotification, "kind" | "subject" | "actorName">,
  t: Translator,
) {
  return t(notificationLineIds[notification.kind], {
    subject: notification.subject,
    actor: notification.actorName ?? t("operations.notifications.someone"),
  });
}

export function notificationLabel(kind: StaffNotificationKind, t: Translator) {
  return t(notificationLabelIds[kind]);
}

/** Kinds in the order the forms list them, under their groups. */
export function groupedKinds(kinds: readonly StaffNotificationKind[]) {
  return staffNotificationGroups
    .map((group) => ({
      group,
      kinds: kinds.filter((kind) => staffNotificationGroup(kind) === group),
    }))
    .filter((entry) => entry.kinds.length > 0);
}
