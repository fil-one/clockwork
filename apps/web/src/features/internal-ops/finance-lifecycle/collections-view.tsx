import { getTranslations } from "@/src/i18n/server";
import { use } from "react";
import { localizeCopy } from "@/src/i18n/copy";
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
import { FinancePageFrame } from "./page-frame";
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
  const localizedcorrectionCopy = localizeCopy(correctionCopy, t);
  if (!entry.billingAccountId)
    return (
      <span className={styles.blocked}>
        {localizedcorrectionCopy.refusals.ACCOUNT_UNRESOLVED}
      </span>
    );
  const subject = {
    invoiceId: entry.invoiceId,
    accountId: entry.billingAccountId,
    currency: entry.currency,
    amountMinor:
      entry.amountMinor === null ? null : entry.amountMinor.toString(),
    reference: entry.reference,
    amountLabel: entry.amount,
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
  const localizedcopy = localizeCopy(copy, t);
  const localizedcorrectionCopy = localizeCopy(correctionCopy, t);
  const summary = summarizeCollectionCases(cases);

  return (
    <FinancePageFrame
      title={localizedcopy.title}
      description={localizedcopy.description}
      provenance={provenance}
    >
      <section className={styles.summaryGrid} aria-label="Collections health">
        <article className={styles.summaryCard}>
          <p>{localizedcopy.openTotal}</p>
          <strong>{summary.openTotal ?? localizedcopy.unrecorded}</strong>
          <span>
            {t("operations.openInvoices", { count: summary.openCount })}
          </span>
        </article>
        <article className={styles.summaryCard}>
          <p>{localizedcopy.overdueTotal}</p>
          <strong>{summary.overdueTotal ?? localizedcopy.unrecorded}</strong>
          <span>
            {t("operations.pastDueInvoices", { count: summary.overdueCount })}
          </span>
        </article>
        <article className={styles.summaryCard}>
          <p>{localizedcopy.oldest}</p>
          <strong>
            {summary.oldestOverdueDays === null
              ? localizedcopy.unrecorded
              : localizedcopy.days(summary.oldestOverdueDays)}
          </strong>
          <span>{localizedcopy.priorityBody}</span>
        </article>
      </section>

      {summary.excludedByCurrency > 0 ? (
        <div className={styles.warningNotice} role="note">
          <strong>
            {localizedcopy.mixedCurrency(summary.excludedByCurrency)}
          </strong>
        </div>
      ) : null}

      <section className={styles.section} aria-labelledby="collections-table">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="collections-table">{localizedcopy.tableHeading}</h2>
            <p>{localizedcopy.tableSubheading}</p>
          </div>
          <span className={styles.sectionMeta}>
            {t("common.results", { count: cases.length })} ·{" "}
            {localizedcopy.priorityTitle.toLocaleLowerCase()}
          </span>
        </header>
        {cases.length === 0 ? (
          <p className={styles.empty}>{localizedcopy.empty}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={localizedcopy.caption}
            captionHidden
            density="compact"
            headers={[
              "Priority / invoice",
              "Amount",
              "Age",
              "Status",
              "Next action",
              localizedcorrectionCopy.heading,
            ]}
            numericColumns={[1, 2]}
            rowKeys={cases.map((entry) => entry.id)}
            rows={cases.map((entry, index) => [
              <div className={styles.primaryCell}>
                <span className={styles.secondary}>Priority {index + 1}</span>
                <strong>{entry.reference}</strong>
                <details className={styles.disclosure}>
                  <summary>Technical evidence</summary>
                  <p>
                    Invoice ID:{" "}
                    <span className={styles.id}>{entry.invoiceId}</span>
                  </p>
                  {entry.billingAccountId ? (
                    <p>
                      Billing account:{" "}
                      <span className={styles.id}>
                        {entry.billingAccountId}
                      </span>
                    </p>
                  ) : null}
                  {entry.evidence.map((item) => (
                    <p key={`${item.label}-${item.value}`}>
                      {item.label}: {item.value}
                    </p>
                  ))}
                </details>
              </div>,
              <strong>{entry.amount ?? localizedcopy.unrecorded}</strong>,
              entry.overdueDays === null
                ? localizedcopy.unrecorded
                : localizedcopy.days(entry.overdueDays),
              <>
                <StatusBadge tone={riskTone(entry)}>
                  {entry.statusLabel}
                </StatusBadge>
                <div className={styles.secondary}>
                  {entry.dueLabel ?? localizedcopy.unrecorded}
                </div>
              </>,
              entry.nextAction ?? localizedcopy.unrecorded,
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
