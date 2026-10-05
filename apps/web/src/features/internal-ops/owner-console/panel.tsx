"use client";

import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { rtlLocales, type MessageId } from "@/src/i18n";
import { useLocale, useTranslations } from "@/src/i18n/client";

import type { ConsoleSection } from "./model";
import styles from "./owner-console.module.css";

/** One card on the owner console, titled, with an optional count and link. */
export function Panel({
  id,
  title,
  description,
  action,
  count,
  wide = false,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Shown beside the title when there is something waiting. */
  count?: number;
  /** Spans the full width on wide screens. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`${styles.panel} ${wide ? styles.wide : ""}`.trim()}
      aria-labelledby={`${id}-title`}
    >
      <div className={styles.panelHeader}>
        <div>
          <h2 id={`${id}-title`}>
            {title}
            {count !== undefined && count > 0 ? (
              <span className={styles.count}>{count}</span>
            ) : null}
          </h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A section's records, or why there are none. */
export function SectionBody<T>({
  section,
  empty,
  children,
}: {
  section: ConsoleSection<T>;
  empty: MessageId;
  children: (items: readonly T[]) => ReactNode;
}) {
  const t = useTranslations();
  if (section.state === "unavailable")
    return (
      <p className={styles.unavailable} role="status">
        {t("operations.owner.section.unavailable")}
      </p>
    );
  if (section.items.length === 0)
    return <p className={styles.empty}>{t(empty)}</p>;
  return children(section.items);
}

export function PanelLink({
  href,
  children,
}: {
  href: Route;
  children: ReactNode;
}) {
  // The arrow points the way the line reads, so it turns round in Arabic.
  const forward = rtlLocales.has(useLocale()) ? "←" : "→";
  return (
    <Link className={styles.panelLink} href={href}>
      {children}
      <span aria-hidden="true">{forward}</span>
    </Link>
  );
}
