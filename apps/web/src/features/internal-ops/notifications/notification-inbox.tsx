"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

import type {
  StaffNotification,
  StaffNotificationKind,
  StaffNotificationPreferences,
} from "@clockwork/contracts";
import {
  Button,
  Checkbox,
  EmptyState,
  FormActions,
  InlineNotice,
  PageHeader,
  StateBanner,
  StatusBadge,
} from "@clockwork/ui";

import { useTranslations } from "@/src/i18n/client";

import { LocalTimestamp } from "../local-timestamp";
import { SessionExpiredReload } from "../session-expiry";
import {
  markAllNotificationsRead,
  markNotificationsRead,
  saveNotificationPreferences,
} from "./actions";
import { notificationsChangedEvent } from "./bell";
import {
  groupedKinds,
  notificationGroupIds,
  notificationLabel,
  notificationLine,
} from "./model";
import type { NotificationInboxData } from "./page-data";
import styles from "./notifications.module.css";

type Message = { tone: "success" | "danger"; text: string; expired?: boolean };

const announce = () =>
  window.dispatchEvent(new Event(notificationsChangedEvent));

/** The inbox at /internal/notifications, with the reader's email choices. */
export function NotificationInbox({
  initial,
}: {
  initial: NotificationInboxData;
}) {
  const t = useTranslations();
  const [items, setItems] = useState(initial.page.notifications);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const unread = items.filter((n) => !n.readAt).length;

  const failed = (code: string): Message =>
    code === "SESSION_EXPIRED"
      ? {
          tone: "danger",
          text: t("operations.notifications.error"),
          expired: true,
        }
      : { tone: "danger", text: t("operations.notifications.error") };

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    setBusy(ids.length === 1 ? (ids[0] ?? null) : "all");
    try {
      const result = await markNotificationsRead({ ids });
      if (!result.ok) {
        setMessage(failed(result.code));
        return;
      }
      const now = new Date().toISOString();
      setItems((current) =>
        current.map((n) => (ids.includes(n.id) ? { ...n, readAt: now } : n)),
      );
      announce();
    } finally {
      setBusy(null);
    }
  }

  async function markAll() {
    setBusy("all");
    try {
      const result = await markAllNotificationsRead();
      if (!result.ok) {
        setMessage(failed(result.code));
        return;
      }
      const now = new Date().toISOString();
      setItems((current) =>
        current.map((n) => ({ ...n, readAt: n.readAt ?? now })),
      );
      announce();
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className={styles.main} id="main-content">
      <PageHeader
        title={t("operations.notifications.title")}
        description={t("operations.notifications.description")}
        {...(initial.canManage
          ? {
              actions: (
                <Link
                  className="cw-button cw-button--secondary"
                  href="/internal/notifications/settings"
                >
                  {t("operations.notifications.settingsLink")}
                </Link>
              ),
            }
          : {})}
      />
      {initial.demo ? (
        <InlineNotice tone="info" title={t("operations.notifications.demo")} />
      ) : null}
      {message ? (
        <StateBanner
          tone={message.tone}
          live={message.tone === "danger" ? "assertive" : "polite"}
          title={message.text}
          {...(message.expired
            ? {
                action: (
                  <SessionExpiredReload onReloaded={() => setMessage(null)} />
                ),
              }
            : {})}
        />
      ) : null}
      <section className={styles.card} aria-labelledby="notifications-list">
        <div className={styles.toolbar}>
          <h2 id="notifications-list">
            {t("operations.notifications.unreadCount", { count: unread })}
          </h2>
          <Button
            variant="secondary"
            size="small"
            disabled={unread === 0 || busy !== null}
            loading={busy === "all"}
            onClick={() => void markAll()}
          >
            {t("operations.notifications.markAllRead")}
          </Button>
        </div>
        {items.length === 0 ? (
          <EmptyState
            title={t("operations.notifications.empty.title")}
            description={t("operations.notifications.empty.description")}
          />
        ) : (
          <ul
            className={styles.list}
            aria-label={t("operations.notifications.title")}
          >
            {items.map((n) => (
              <Item
                key={n.id}
                notification={n}
                busy={busy}
                onRead={(id) => void markRead([id])}
              />
            ))}
          </ul>
        )}
        {initial.page.more ? (
          <p className={styles.muted}>
            {t("operations.notifications.olderHidden", { count: items.length })}
          </p>
        ) : null}
      </section>
      <Preferences
        initial={initial.preferences}
        kinds={initial.kinds}
        email={initial.email}
        emailActive={initial.emailActive}
        demo={initial.demo}
        onMessage={setMessage}
        failed={failed}
      />
    </main>
  );
}

function Item({
  notification: n,
  busy,
  onRead,
}: {
  notification: StaffNotification;
  busy: string | null;
  onRead: (id: string) => void;
}) {
  const t = useTranslations();
  const line = notificationLine(n, t);
  return (
    <li className={styles.item} data-unread={n.readAt ? "false" : "true"}>
      <div>
        <p className={styles.line}>
          <Link
            href={n.href as Route}
            onClick={() => {
              // Opening a notification reads it; the request may finish
              // after the page has moved on, which is fine.
              if (!n.readAt) onRead(n.id);
            }}
          >
            {line}
          </Link>
        </p>
        {n.detail ? (
          <p className={styles.note}>
            {t("operations.notifications.note", { note: n.detail })}
          </p>
        ) : null}
        <p className={styles.meta}>
          {!n.readAt ? (
            <StatusBadge tone="info">
              {t("operations.notifications.unread")}
            </StatusBadge>
          ) : null}
          <LocalTimestamp value={n.createdAt} />
        </p>
      </div>
      <div className={styles.itemActions}>
        {!n.readAt ? (
          <Button
            variant="quiet"
            size="small"
            disabled={busy !== null}
            loading={busy === n.id}
            aria-label={t("operations.notifications.markReadNamed", {
              subject: n.subject,
            })}
            onClick={() => onRead(n.id)}
          >
            {t("operations.notifications.markRead")}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function Preferences({
  initial,
  kinds,
  email,
  emailActive,
  demo,
  onMessage,
  failed,
}: {
  initial: StaffNotificationPreferences;
  kinds: readonly StaffNotificationKind[];
  email: string;
  emailActive: boolean;
  demo: boolean;
  onMessage: (message: Message | null) => void;
  failed: (code: string) => Message;
}) {
  const t = useTranslations();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const changed =
    draft.emailEnabled !== saved.emailEnabled ||
    [...draft.emailMutedKinds].sort().join() !==
      [...saved.emailMutedKinds].sort().join();

  async function save() {
    onMessage(null);
    setBusy(true);
    try {
      const result = await saveNotificationPreferences(draft);
      if (!result.ok) {
        onMessage(failed(result.code));
        return;
      }
      setSaved(result.value);
      setDraft(result.value);
      onMessage({
        tone: "success",
        text: t("operations.notifications.preferences.saved"),
      });
    } finally {
      setBusy(false);
    }
  }

  const toggleKind = (kind: StaffNotificationKind, on: boolean) =>
    setDraft((current) => ({
      ...current,
      emailMutedKinds: on
        ? current.emailMutedKinds.filter((k) => k !== kind)
        : [...current.emailMutedKinds, kind],
    }));

  return (
    <section className={styles.card} aria-labelledby="notification-preferences">
      <div>
        <h2 id="notification-preferences">
          {t("operations.notifications.preferences.title")}
        </h2>
        <p className={styles.muted}>
          {t("operations.notifications.preferences.description")}
        </p>
      </div>
      {!emailActive && !demo ? (
        <InlineNotice
          tone="info"
          title={t("operations.notifications.preferences.channelOff")}
        />
      ) : null}
      <form
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Checkbox
          label={t("operations.notifications.preferences.emailEnabled")}
          description={t(
            "operations.notifications.preferences.emailEnabledHelp",
            {
              email,
            },
          )}
          checked={draft.emailEnabled}
          disabled={demo}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              emailEnabled: event.target.checked,
            }))
          }
        />
        {draft.emailEnabled && kinds.length > 0 ? (
          <fieldset className={styles.kinds} disabled={demo}>
            <legend className="sr-only">
              {t("operations.notifications.preferences.kinds")}
            </legend>
            {groupedKinds(kinds).map(({ group, kinds: groupKinds }) => (
              <fieldset key={group}>
                <legend>{t(notificationGroupIds[group])}</legend>
                {groupKinds.map((kind) => (
                  <Checkbox
                    key={kind}
                    label={notificationLabel(kind, t)}
                    checked={!draft.emailMutedKinds.includes(kind)}
                    onChange={(event) => toggleKind(kind, event.target.checked)}
                  />
                ))}
              </fieldset>
            ))}
          </fieldset>
        ) : null}
        {!demo ? (
          <FormActions>
            <Button type="submit" loading={busy} disabled={busy || !changed}>
              {t("common.save")}
            </Button>
          </FormActions>
        ) : null}
      </form>
    </section>
  );
}
