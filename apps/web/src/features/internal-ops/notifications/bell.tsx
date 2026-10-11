"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Bell } from "@clockwork/ui";

import { useTranslations } from "@/src/i18n/client";

import styles from "./notifications.module.css";

/** How often an open staff page asks for the unread count. */
export const notificationPollMs = 30_000;

/** Pages that change read state announce it so the bell catches up at once. */
export const notificationsChangedEvent = "clockwork:notifications-changed";

/**
 * The bell in the staff shell. It links to the inbox and shows how many
 * notifications are unread, read afresh on every navigation, every 30
 * seconds while the page is visible, and whenever the inbox changes them. A
 * count that cannot be read shows no number rather than a stale one.
 */
export function NotificationBell() {
  const t = useTranslations();
  const pathname = usePathname();
  const [unread, setUnread] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/internal/notifications/unread", {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (response.status !== 200) {
        setUnread(null);
        return;
      }
      const body = (await response.json()) as { unread?: unknown };
      setUnread(
        typeof body.unread === "number" && Number.isSafeInteger(body.unread)
          ? body.unread
          : null,
      );
    } catch {
      setUnread(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    const onChange = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, notificationPollMs);
    window.addEventListener(notificationsChangedEvent, onChange);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener(notificationsChangedEvent, onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const label =
    unread && unread > 0
      ? t("operations.notifications.bellUnread", { count: unread })
      : t("operations.notifications.bell");
  return (
    <Link
      className={`icon-action ${styles.bell ?? ""}`}
      href="/internal/notifications"
      aria-label={label}
      title={label}
      data-testid="notification-bell"
    >
      <Bell aria-hidden="true" size={19} strokeWidth={1.8} />
      {unread && unread > 0 ? (
        <span className={styles.badge} aria-hidden="true">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
