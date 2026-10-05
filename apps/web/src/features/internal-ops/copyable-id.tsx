"use client";

import { useState } from "react";

import { useTranslations } from "@/src/i18n/client";

import styles from "./copyable-id.module.css";

/**
 * A record identifier set beneath the human name it belongs to, with a button
 * that copies it. Identifiers are what staff paste into an email or a ticket,
 * so they stay one click away without leading the row.
 */
export function CopyableId({
  value,
  label,
}: {
  value: string;
  /** What the identifier is ("Order"), for the button's accessible name. */
  label: string;
}) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  return (
    <span className={styles.root}>
      {/* <bdi> keeps a Latin identifier from reordering an Arabic line. */}
      <bdi className={styles.value}>{value}</bdi>
      <button
        className={styles.copy}
        type="button"
        aria-label={t("operations.copyId.label", { label, id: value })}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
        onBlur={() => setCopied(false)}
      >
        {copied ? t("common.copied") : t("common.copy")}
      </button>
      <span className={styles.status} role="status">
        {copied ? t("operations.copyId.copied", { id: value }) : ""}
      </span>
    </span>
  );
}
