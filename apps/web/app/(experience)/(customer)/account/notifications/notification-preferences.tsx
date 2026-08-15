"use client";

import Link from "next/link";
import { useState } from "react";

import { ApplicationStatePanel, buttonClassName } from "@clockwork/ui";

import styles from "@/src/features/customer-partner/commercial/commercial.module.css";

import { storeNotificationPreference } from "./notification-preference-client";
import {
  alertPreferenceRows,
  notificationChannel,
  refusedAlerts,
  suppressedAlertCount,
  type StoredPreference,
} from "./notification-preference-model";

export interface NotificationPreferencesContext {
  /** The account the preference rows belong to; from the route, not a prop default. */
  accountId: string;
  accountName: string;
  /** `account:write` on the acting role, resolved on the server. */
  canManage: boolean;
  stored: readonly StoredPreference[];
}

/**
 * The account surface for `notification_preferences` (001400).
 *
 * P0-46's residue is that `/v1/notifications/preferences` existed and no
 * surface managed it. This is that surface, and nothing more: per-user and
 * per-account granularity is P2 (docs/backlog.md, "Per-user and per-account
 * notification preferences"), so every control here is account-wide, and the
 * delivery log `/v1/notifications` exposes is deliberately not rendered.
 */
export function NotificationPreferences({
  context,
}: {
  context: NotificationPreferencesContext;
}) {
  const [stored, setStored] = useState<readonly StoredPreference[]>(
    context.stored,
  );
  const [pendingKind, setPendingKind] = useState("");
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const rows = alertPreferenceRows(stored);
  const suppressed = suppressedAlertCount(rows);

  async function toggle(alertKind: string, enabled: boolean) {
    setPendingKind(alertKind);
    setNotice("");
    setFailure("");
    try {
      const result = await storeNotificationPreference({
        accountId: context.accountId,
        alertKind,
        enabled,
      });
      // The server's answer replaces the local guess, so a stored row that came
      // back different from what was asked is what the page then states.
      setStored((current) => [
        ...current.filter(
          (row) =>
            !(
              row.alertKind === result.alertKind &&
              row.channel === result.channel
            ),
        ),
        {
          alertKind: result.alertKind,
          channel: result.channel,
          enabled: result.enabled,
        },
      ]);
      setNotice(
        result.enabled
          ? `${labelFor(alertKind)} will be sent to this account.`
          : `${labelFor(alertKind)} will no longer be sent to this account.`,
      );
    } catch (error) {
      // Nothing local changed, so the checkbox is still showing the stored
      // value and there is no optimistic state to unwind.
      setFailure(
        error instanceof Error
          ? error.message
          : "The preference could not be saved. Nothing was changed.",
      );
    } finally {
      setPendingKind("");
    }
  }

  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Account notifications</p>
          <h1>Notification preferences</h1>
          <p className={styles.description}>
            Which optional alerts Fil One sends {context.accountName} by email.
            A choice applies to the whole account and to every person on it.
          </p>
        </div>
        <Link className={styles.secondary} href="/account">
          Return to account
        </Link>
      </header>

      <section className={styles.panel} aria-labelledby="optional-alerts-title">
        <div>
          <p className={styles.eyebrow}>
            {notificationChannel === "email"
              ? "Email is the only delivery channel"
              : notificationChannel}
          </p>
          <h2 id="optional-alerts-title">Optional alerts</h2>
          <p>
            An alert you have never changed is on. Turning one off records that
            choice against the account; nothing else about the alert changes.
            {suppressed > 0
              ? ` ${suppressed} of ${rows.length} are currently switched off.`
              : ""}
          </p>
        </div>
        <ul className={styles.reviewList}>
          {rows.map((row) => (
            <li key={row.kind}>
              <label className={styles.check} htmlFor={`alert-${row.kind}`}>
                <input
                  checked={row.enabled}
                  disabled={!context.canManage || pendingKind === row.kind}
                  id={`alert-${row.kind}`}
                  onChange={(event) => {
                    void toggle(row.kind, event.target.checked);
                  }}
                  type="checkbox"
                />
                <span>
                  <strong>{row.label}</strong>
                  <br />
                  {row.description}
                  <br />
                  <small>
                    {row.isDefault
                      ? "No stored choice — on by default."
                      : row.enabled
                        ? "Stored choice: on."
                        : "Stored choice: off."}
                  </small>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {context.canManage ? null : (
          <p className={styles.description}>
            Your role can read these settings but not change them. An owner or
            an admin on this account can.
          </p>
        )}
        {failure ? (
          <p className={styles.errorMessage} role="alert">
            {failure}
          </p>
        ) : null}
        {notice ? (
          <p className={styles.successMessage} role="status">
            {notice}
          </p>
        ) : null}
      </section>

      <section
        className={styles.panel}
        aria-labelledby="required-notices-title"
      >
        <div>
          <p className={styles.eyebrow}>Not optional</p>
          <h2 id="required-notices-title">
            Notices that cannot be switched off
          </h2>
          <p>
            These two, and only these two, are refused by the server. Every
            other alert this platform sends is in the list above.
          </p>
        </div>
        <ul className={styles.reviewList}>
          {refusedAlerts.map((alert) => (
            <li key={alert.kind}>
              <span>{alert.label}</span>
              <strong>{alert.reason}</strong>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function labelFor(alertKind: string): string {
  return (
    alertPreferenceRows([]).find((row) => row.kind === alertKind)?.label ??
    alertKind
  );
}

/**
 * The runtime database is what `notification_preference_scope` bounds the read
 * with, so an environment without one has no preferences to show and must say
 * so rather than render three controls that would post into nothing.
 */
export function NotificationPreferencesUnavailable() {
  return (
    <main className={styles.main} id="main-content">
      <div className={styles.state}>
        <ApplicationStatePanel
          state="empty"
          title="Notification preferences are unavailable"
          description="Preferences are stored per account and read through the tenant connection, and this deployment has no runtime database configured. Nothing is being suppressed: every alert this account would receive is still being sent."
          action={
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href="/account"
            >
              Return to account
            </Link>
          }
        />
      </div>
    </main>
  );
}
