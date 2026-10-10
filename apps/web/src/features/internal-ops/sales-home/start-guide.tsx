"use client";

import { useId, useSyncExternalStore } from "react";

import { useTranslations } from "@/src/i18n/client";

import styles from "./sales-home.module.css";

/** Per person and per browser; a cleared or blocked store shows the guide again. */
export const startGuideStorageKey = (userId: string) =>
  `fil-one-commerce:start-guide-dismissed:${userId}`;

// Blocked storage (a private window, a locked-down browser) still honours the
// choice for as long as the page is open. Showing the guide again lasts for
// the page only; hiding it is remembered.
const remembered = new Map<string, boolean>();
const listeners = new Set<() => void>();

/** True when hidden, false when shown, null when the reader never chose. */
function readChoice(key: string): boolean | null {
  const inMemory = remembered.get(key);
  if (inMemory !== undefined) return inMemory;
  try {
    return window.localStorage.getItem(key) === "1" ? true : null;
  } catch {
    return null;
  }
}

function writeDismissed(key: string, dismissed: boolean) {
  remembered.set(key, dismissed);
  try {
    if (dismissed) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    // Kept in memory above.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * The first-run guide to sending an MNDA, after the reader's work. It is open until
 * the reader has sent an MNDA, then folds to one line; a reader who hid it
 * sees it folded as the page hydrates, and can open it again.
 */
export function StartGuide({
  userId,
  collapsedByDefault,
}: {
  userId: string;
  /** The reader has sent an MNDA, so the steps are no longer news. */
  collapsedByDefault: boolean;
}) {
  const t = useTranslations();
  const key = startGuideStorageKey(userId);
  const choice = useSyncExternalStore(
    subscribe,
    () => readChoice(key),
    () => null,
  );
  const collapsed = choice ?? collapsedByDefault;
  const headingId = useId();

  if (collapsed)
    return (
      <p className={styles.guideRestore}>
        <button
          type="button"
          className={styles.textButton}
          onClick={() => writeDismissed(key, false)}
        >
          {t("operations.sales.home.start.show")}
        </button>
      </p>
    );

  return (
    <section className={styles.guide} aria-labelledby={headingId}>
      <div className={styles.guideHeading}>
        <div>
          <h2 id={headingId}>{t("operations.sales.home.start.title")}</h2>
          <p>{t("operations.sales.home.start.intro")}</p>
        </div>
        <button
          type="button"
          className={styles.textButton}
          onClick={() => writeDismissed(key, true)}
        >
          {t("operations.sales.home.start.dismiss")}
        </button>
      </div>
      <ol className={styles.steps}>
        <li>{t("operations.sales.home.start.step1")}</li>
        <li>{t("operations.sales.home.start.step2")}</li>
        <li>{t("operations.sales.home.start.step3")}</li>
        <li>{t("operations.sales.home.start.step4")}</li>
      </ol>
      <p className={styles.guideHelp}>
        {t("operations.sales.home.start.help")}
      </p>
    </section>
  );
}
