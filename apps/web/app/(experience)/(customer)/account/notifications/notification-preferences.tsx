"use client";

import Link from "next/link";
import { useState } from "react";

import { ApplicationStatePanel, buttonClassName } from "@clockwork/ui";

import styles from "@/src/features/customer-partner/commercial/commercial.module.css";
import type { MessageId } from "@/src/i18n";
import { useTranslations } from "@/src/i18n/client";

import {
  NotificationPreferenceRequestError,
  storeNotificationPreference,
  type NotificationPreferenceFailure,
} from "./notification-preference-client";
import {
  alertPreferenceRows,
  notificationChannel,
  refusedAlerts,
  suppressedAlertCount,
  type StoredPreference,
} from "./notification-preference-model";

const failureMessages: Readonly<
  Record<NotificationPreferenceFailure, MessageId>
> = {
  secureTokenMissing: "customer.notifications.failure.secureTokenMissing",
  unreachable: "customer.notifications.failure.unreachable",
  notOptional: "customer.notifications.failure.notOptional",
  forbidden: "customer.notifications.failure.forbidden",
  unavailable: "customer.notifications.failure.unavailable",
  notSaved: "customer.notifications.failure.notSaved",
};

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
  const t = useTranslations();
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
      const label = labelFor(alertKind);
      // An alert kind this build offers always has a label; the code is only
      // a guard against a stored kind the build does not know.
      const alert = label ? t(label) : alertKind;
      setNotice(
        result.enabled
          ? t("customer.notifications.notice.on", { alert })
          : t("customer.notifications.notice.off", { alert }),
      );
    } catch (error) {
      // Nothing local changed, so the checkbox is still showing the stored
      // value and there is no optimistic state to unwind.
      setFailure(
        t(
          failureMessages[
            error instanceof NotificationPreferenceRequestError
              ? error.reason
              : "notSaved"
          ],
        ),
      );
    } finally {
      setPendingKind("");
    }
  }

  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            {t("customer.notifications.eyebrow")}
          </p>
          <h1>{t("customer.notifications.title")}</h1>
          <p className={styles.description}>
            {t("customer.notifications.description", {
              account: context.accountName,
            })}
          </p>
        </div>
        <Link className={styles.secondary} href="/account">
          {t("customer.notifications.returnToAccount")}
        </Link>
      </header>

      <section className={styles.panel} aria-labelledby="optional-alerts-title">
        <div>
          <p className={styles.eyebrow}>
            {notificationChannel === "email"
              ? t("customer.notifications.emailOnly")
              : notificationChannel}
          </p>
          <h2 id="optional-alerts-title">
            {t("customer.notifications.optional.title")}
          </h2>
          <p>
            {suppressed > 0
              ? t("common.join.sentences", {
                  first: t("customer.notifications.optional.description"),
                  second: t("customer.notifications.optional.suppressed", {
                    count: suppressed,
                    total: rows.length,
                  }),
                })
              : t("customer.notifications.optional.description")}
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
                  <strong>{t(row.label)}</strong>
                  <br />
                  {t(row.description)}
                  <br />
                  <small>
                    {t(
                      row.isDefault
                        ? "customer.notifications.stored.default"
                        : row.enabled
                          ? "customer.notifications.stored.on"
                          : "customer.notifications.stored.off",
                    )}
                  </small>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {context.canManage ? null : (
          <p className={styles.description}>
            {t("customer.notifications.readOnly")}
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
          <p className={styles.eyebrow}>
            {t("customer.notifications.required.eyebrow")}
          </p>
          <h2 id="required-notices-title">
            {t("customer.notifications.required.title")}
          </h2>
          <p>{t("customer.notifications.required.description")}</p>
        </div>
        <ul className={styles.reviewList}>
          {refusedAlerts.map((alert) => (
            <li key={alert.kind}>
              <span>{t(alert.label)}</span>
              <strong>{t(alert.reason)}</strong>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function labelFor(alertKind: string): MessageId | undefined {
  return alertPreferenceRows([]).find((row) => row.kind === alertKind)?.label;
}

/**
 * The runtime database is what `notification_preference_scope` bounds the read
 * with, so an environment without one has no preferences to show and must say
 * so rather than render three controls that would post into nothing.
 */
export function NotificationPreferencesUnavailable() {
  const t = useTranslations();
  return (
    <main className={styles.main} id="main-content">
      <div className={styles.state}>
        <ApplicationStatePanel
          state="empty"
          title={t("customer.notifications.unavailable.title")}
          description={t("customer.notifications.unavailable.description")}
          action={
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href="/account"
            >
              {t("customer.notifications.returnToAccount")}
            </Link>
          }
        />
      </div>
    </main>
  );
}
