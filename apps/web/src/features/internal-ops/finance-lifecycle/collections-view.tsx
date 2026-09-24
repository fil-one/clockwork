import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { use } from "react";
import { StatusBadge, Table } from "@clockwork/ui";

import { ProjectionActionButtons } from "@/src/features/experience-server/projection-action-buttons";
import { SurfaceActionGate } from "@/src/features/shell/permission-gate";

import { correctionCopy } from "../collections-corrections/copy";
import { CorrectionDialog } from "../collections-corrections/correction-dialog";
import { correctionKinds } from "../collections-corrections/model";
import { lifecycleCopy } from "./copy";
import {
  summarizeCollectionCases,
  type CollectionCase,
} from "./collections-projection";
import { FinancePageFrame, IdentifierLine, RecordEvidence } from "./page-frame";
import {
  formatCalendarDay,
  formatMinorAmount,
  invoiceStatusMessages,
  statusText,
  type MinorAmount,
} from "./projection-fields";
import type { SurfaceProvenance } from "./provenance";
import styles from "./finance-lifecycle.module.css";

const copy = lifecycleCopy.collections;

function riskTone(
  entry: CollectionCase,
): "neutral" | "warning" | "danger" | "success" {
  if (entry.paidAt) return "success";
  if (entry.overdue || entry.risk === "high") return "danger";
  if (entry.risk === "medium") return "warning";
  return "neutral";
}

function Corrections({ entry }: { entry: CollectionCase }) {
  const t = use(getTranslations());
  if (!entry.billingAccountId)
    return (
      <span className={styles.blocked}>
        {t(correctionCopy.refusals.ACCOUNT_UNRESOLVED)}
      </span>
    );
  const subject = {
    invoiceId: entry.invoiceId,
    accountId: entry.billingAccountId,
    currency: entry.currency,
    amountMinor:
      entry.amountMinor === null ? null : entry.amountMinor.toString(),
    reference: entry.reference,
  };
  return (
    <>
      {correctionKinds.map((kind) => (
        <CorrectionDialog key={kind} kind={kind} subject={subject} />
      ))}
    </>
  );
}

export function CollectionsView({
  cases,
  roles,
  provenance,
}: {
  cases: readonly CollectionCase[];
  roles: readonly string[];
  provenance: SurfaceProvenance;
}) {
  const t = use(getTranslations());
  const locale = use(getFormattingLocale());
  const summary = summarizeCollectionCases(cases);
  const money = (amount: MinorAmount | null) =>
    amount
      ? formatMinorAmount(amount.minor, amount.currency, locale)
      : t("common.notRecorded");

  /** The invoice's settlement or deadline, from its own dates. */
  function dueLine(entry: CollectionCase): string {
    const paid = formatCalendarDay(entry.paidAt, locale);
    if (paid) return t(copy.paidOn, { date: paid });
    const due = formatCalendarDay(entry.dueAt, locale);
    return due ? t("common.dueOn", { date: due }) : t(copy.noDueDate);
  }

  return (
    <FinancePageFrame
      title={t(copy.title)}
      description={t(copy.description)}
      provenance={provenance}
    >
      <section className={styles.summaryGrid} aria-label={t(copy.summaryLabel)}>
        <article className={styles.summaryCard}>
          <p>{t(copy.openTotal)}</p>
          <strong>{money(summary.openAmount)}</strong>
          <span>{t(copy.openCount, { count: summary.openCount })}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{t(copy.overdueTotal)}</p>
          <strong>{money(summary.overdueAmount)}</strong>
          <span>{t(copy.overdueCount, { count: summary.overdueCount })}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{t(copy.oldest)}</p>
          <strong>
            {summary.oldestOverdueDays === null
              ? t("common.notRecorded")
              : t(copy.days, { count: summary.oldestOverdueDays })}
          </strong>
          <span>{t(copy.priorityBody)}</span>
        </article>
      </section>

      {summary.excludedByCurrency > 0 ? (
        <div className={styles.warningNotice} role="note">
          <strong>
            {t(copy.mixedCurrency, { count: summary.excludedByCurrency })}
          </strong>
        </div>
      ) : null}

      <section className={styles.section} aria-labelledby="collections-table">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="collections-table">{t(copy.tableHeading)}</h2>
            <p>{t(copy.tableSubheading)}</p>
          </div>
          <span className={styles.sectionMeta}>
            {t(copy.tableMeta, { count: cases.length })}
          </span>
        </header>
        {cases.length === 0 ? (
          <p className={styles.empty}>{t(copy.empty)}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={t(copy.caption)}
            captionHidden
            density="compact"
            headers={[
              t(copy.columns.priority),
              t("common.amount"),
              t(copy.columns.age),
              t("common.status"),
              t("common.nextAction"),
              t(correctionCopy.heading),
            ]}
            numericColumns={[1, 2]}
            rowKeys={cases.map((entry) => entry.id)}
            rows={cases.map((entry, index) => [
              <div className={styles.primaryCell}>
                <span className={styles.secondary}>
                  {t(copy.priorityRank, { rank: String(index + 1) })}
                </span>
                <strong>{entry.reference}</strong>
                <details className={styles.disclosure}>
                  <summary>{t(lifecycleCopy.evidence.technical)}</summary>
                  <IdentifierLine
                    label={lifecycleCopy.evidence.invoiceId}
                    value={entry.invoiceId}
                  />
                  {entry.billingAccountId ? (
                    <IdentifierLine
                      label={lifecycleCopy.evidence.billingAccount}
                      value={entry.billingAccountId}
                    />
                  ) : null}
                  <RecordEvidence
                    entries={entry.evidence}
                    version={entry.version}
                    updatedAt={entry.updatedAt}
                  />
                </details>
              </div>,
              <strong>
                {entry.amountMinor === null
                  ? t("common.notRecorded")
                  : formatMinorAmount(
                      entry.amountMinor,
                      entry.currency,
                      locale,
                    )}
              </strong>,
              entry.overdueDays === null
                ? t("common.notRecorded")
                : t(copy.days, { count: entry.overdueDays }),
              <>
                <StatusBadge tone={riskTone(entry)}>
                  {statusText(
                    t,
                    [entry.invoiceStatus, entry.status],
                    entry.statusLabel,
                    invoiceStatusMessages,
                  )}
                </StatusBadge>
                <div className={styles.secondary}>{dueLine(entry)}</div>
              </>,
              entry.nextAction ?? t("common.notRecorded"),
              <div className={styles.actionStack}>
                {/*
                 * The invoice aggregate's own projection verb. `actionsFor`
                 * offers `evaluate_dunning` on an open or issued invoice and
                 * nothing else, and it writes a collection case rather than
                 * touching the invoice. It is version-bound, so a stale page
                 * cannot run it.
                 */}
                <ProjectionActionButtons
                  audience="internal"
                  channel="collections"
                  recordKey={entry.id}
                  projectionId={entry.projectionId}
                  version={entry.version}
                  actions={entry.permittedActions}
                  roles={roles}
                />
                <SurfaceActionGate
                  audience="internal"
                  requiredPermission="billing:approve"
                >
                  <Corrections entry={entry} />
                </SurfaceActionGate>
              </div>,
            ])}
          />
        )}
      </section>
    </FinancePageFrame>
  );
}
