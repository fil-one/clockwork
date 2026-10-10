import type { ContractListRow } from "@clockwork/contracts";
import { StatusBadge } from "@clockwork/ui";
import type { Translator } from "@/src/i18n";
import {
  contractStatusLabels,
  contractStatusTone,
  signingStateLabels,
  signingStateTone,
  daysUntil,
  formatContractDate,
} from "./copy";
import styles from "./contracts.module.css";

/** A calendar date, or a dash with a spoken "not set". On a record page,
 * where a dash reads as missing data, `spelled` writes "Not set" out. */
export function DateValue({
  date,
  t,
  locale,
  spelled = false,
}: {
  date: string | null;
  t: Translator;
  locale: string;
  spelled?: boolean;
}) {
  if (!date && spelled) return <span>{t("operations.contracts.notSet")}</span>;
  if (!date)
    return (
      <span>
        <span aria-hidden="true">—</span>
        <span className="cw-sr-only">{t("operations.contracts.notSet")}</span>
      </span>
    );
  return <time dateTime={date}>{formatContractDate(date, locale)}</time>;
}

/** A deadline with how far away it is, urgent inside two weeks. */
export function DeadlineValue({
  date,
  today,
  t,
  locale,
  spelled = false,
}: {
  date: string | null;
  today: string;
  t: Translator;
  locale: string;
  spelled?: boolean;
}) {
  if (!date)
    return <DateValue date={null} t={t} locale={locale} spelled={spelled} />;
  const days = daysUntil(date, today);
  return (
    <span className={styles.dateCell}>
      <DateValue date={date} t={t} locale={locale} />
      <span
        className={
          days >= 0 && days <= 14 ? styles.urgent : styles.secondaryText
        }
      >
        {days < 0
          ? t("operations.contracts.deadline.passed")
          : days === 0
            ? t("operations.contracts.deadline.today")
            : t("operations.contracts.deadline.inDays", { count: days })}
      </span>
    </span>
  );
}

/** The date the current term ends or renews, labelled which it is. */
export function TermBoundaryValue({
  row,
  t,
  locale,
}: {
  row: Pick<ContractListRow, "renewalDate" | "termEndDate">;
  t: Translator;
  locale: string;
}) {
  if (!row.renewalDate && !row.termEndDate)
    return <DateValue date={null} t={t} locale={locale} />;
  return (
    <span className={styles.dateCell}>
      <DateValue
        date={row.renewalDate ?? row.termEndDate}
        t={t}
        locale={locale}
      />
      <span className={styles.secondaryText}>
        {t(
          row.renewalDate
            ? "operations.contracts.boundary.renews"
            : "operations.contracts.boundary.ends",
        )}
      </span>
    </span>
  );
}

export function StatusValue({
  row,
  t,
}: {
  row: Pick<
    ContractListRow,
    "status" | "source" | "documentCount" | "signingState"
  >;
  t: Translator;
}) {
  // A draft whose signing closed unsigned says how; a request that needs a
  // person says so on any status.
  const shown =
    row.signingState === "attention" ||
    (row.status === "draft" &&
      (row.signingState === "declined" ||
        row.signingState === "expired" ||
        row.signingState === "canceled"));
  return (
    <span className={styles.badges}>
      <StatusBadge tone={contractStatusTone[row.status]}>
        {t(contractStatusLabels[row.status])}
      </StatusBadge>
      {shown && row.signingState ? (
        <StatusBadge tone={signingStateTone(row.signingState)}>
          {t(signingStateLabels[row.signingState])}
        </StatusBadge>
      ) : null}
      {row.status === "executed" &&
      row.source !== "mnda" &&
      row.documentCount === 0 ? (
        <StatusBadge tone="warning">
          {t("operations.contracts.noSignedCopy")}
        </StatusBadge>
      ) : null}
    </span>
  );
}

export function Tags({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return null;
  return (
    <span className={styles.tags}>
      {tags.map((tag) => (
        <span className={styles.tag} key={tag}>
          {tag}
        </span>
      ))}
    </span>
  );
}
