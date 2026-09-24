/**
 * What an account may switch off, and what it may not.
 *
 * `notification_deliveries` (supabase/migrations/001330) records five alert
 * kinds. `notification_preferences` (001400) accepts three of them; its
 * `notification_preferences_alert_kind_check` constraint is the authority and
 * the two it omits are omitted deliberately. This module states both sides
 * because a surface that offered only the manageable three would leave a reader
 * unable to tell whether the other two were missing on purpose or missing by
 * mistake. `notification-preference-model.test.ts` reads both migrations and
 * fails if either list here stops agreeing with the constraint it mirrors.
 */

import type { MessageId } from "@/src/i18n";

/** The one channel `notification_preferences_channel_check` accepts. */
export const notificationChannel = "email";

export interface ManageableAlert {
  /** The `alert_kind` value the PUT body carries. */
  kind: string;
  label: MessageId;
  description: MessageId;
}

/**
 * Advisory alerts. No contract and no invoice depends on one arriving, which is
 * exactly why the constraint admits them.
 */
export const manageableAlerts: readonly ManageableAlert[] = [
  {
    kind: "renewal_term_window",
    label: "customer.notifications.alert.renewalTermWindow",
    description: "customer.notifications.alert.renewalTermWindow.description",
  },
  {
    kind: "poc_milestone",
    label: "customer.notifications.alert.pocMilestone",
    description: "customer.notifications.alert.pocMilestone.description",
  },
  {
    kind: "quote_expiry",
    label: "customer.notifications.alert.quoteExpiry",
    description: "customer.notifications.alert.quoteExpiry.description",
  },
];

export interface RefusedAlert {
  kind: string;
  label: MessageId;
  /** Why the constraint refuses it. Not a policy this surface invented. */
  reason: MessageId;
}

/**
 * The complete refused set. `PUT /v1/notifications/preferences` answers 422
 * `NOTIFICATION_ALERT_KIND_NOT_MANAGEABLE` for these two and for nothing else:
 * every other value the delivery table can carry is in `manageableAlerts`
 * above, and a value in neither list is refused by the same check constraint as
 * an unknown alert kind rather than as an unmanageable one.
 */
export const refusedAlerts: readonly RefusedAlert[] = [
  {
    kind: "renewal_notice_window",
    label: "customer.notifications.refused.renewalNoticeWindow",
    reason: "customer.notifications.refused.renewalNoticeWindow.reason",
  },
  {
    kind: "collections_dunning",
    label: "customer.notifications.refused.collectionsDunning",
    reason: "customer.notifications.refused.collectionsDunning.reason",
  },
];

/** One row of `notification_preferences` as the account has stored it. */
export interface StoredPreference {
  alertKind: string;
  channel: string;
  enabled: boolean;
}

export interface AlertPreferenceRow extends ManageableAlert {
  enabled: boolean;
  /** True when the account has never touched this alert. */
  isDefault: boolean;
}

/**
 * Absence of a row means enabled — the migration says so, and an account that
 * has never opened this page keeps every alert it gets today. A stored row for
 * an alert kind this build does not offer is ignored rather than rendered: the
 * kind would have no label, and dropping it silently is safer than inventing
 * one.
 */
export function alertPreferenceRows(
  stored: readonly StoredPreference[],
): readonly AlertPreferenceRow[] {
  return manageableAlerts.map((alert) => {
    const row = stored.find(
      (candidate) =>
        candidate.alertKind === alert.kind &&
        candidate.channel === notificationChannel,
    );
    return {
      ...alert,
      enabled: row ? row.enabled : true,
      isDefault: !row,
    };
  });
}

export function suppressedAlertCount(
  rows: readonly AlertPreferenceRow[],
): number {
  return rows.filter((row) => !row.enabled).length;
}
