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

/** The one channel `notification_preferences_channel_check` accepts. */
export const notificationChannel = "email";

export interface ManageableAlert {
  /** The `alert_kind` value the PUT body carries. */
  kind: string;
  label: string;
  description: string;
}

/**
 * Advisory alerts. No contract and no invoice depends on one arriving, which is
 * exactly why the constraint admits them.
 */
export const manageableAlerts: readonly ManageableAlert[] = [
  {
    kind: "renewal_term_window",
    label: "Renewal term reminders",
    description:
      "Advance notice that a service term is approaching the window in which it renews.",
  },
  {
    kind: "poc_milestone",
    label: "Proof-of-concept milestones",
    description:
      "Progress updates while a proof of concept is running, including success-test results.",
  },
  {
    kind: "quote_expiry",
    label: "Quote expiry warnings",
    description:
      "A warning before an issued quote lapses and has to be re-priced.",
  },
];

export interface RefusedAlert {
  kind: string;
  label: string;
  /** Why the constraint refuses it. Not a policy this surface invented. */
  reason: string;
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
    label: "Renewal notice deadline",
    reason:
      "The agreement requires this warning before the notice window closes, so it cannot be switched off.",
  },
  {
    kind: "collections_dunning",
    label: "Collections and payment demands",
    reason:
      "This is a demand for payment on an issued invoice. A debtor cannot opt out of being told it owes money.",
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
