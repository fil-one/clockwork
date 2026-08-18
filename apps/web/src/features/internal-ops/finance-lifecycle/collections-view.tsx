import { StatusBadge, Table } from "@clockwork/ui";

import { plural } from "@/src/i18n/en";
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
  if (!entry.billingAccountId)
    return (
      <span className={styles.blocked}>
        {correctionCopy.refusals.ACCOUNT_UNRESOLVED}
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
  const summary = summarizeCollectionCases(cases);

  return (
    <FinancePageFrame
      title={copy.title}
      description={copy.description}
      provenance={provenance}
    >
      <section className={styles.summaryGrid} aria-label="Collections health">
        <article className={styles.summaryCard}>
          <p>{copy.openTotal}</p>
          <strong>{summary.openTotal ?? copy.unrecorded}</strong>
          <span>
            {plural(
              summary.openCount,
              "{count} open invoice",
              "{count} open invoices",
            )}
          </span>
        </article>
        <article className={styles.summaryCard}>
          <p>{copy.overdueTotal}</p>
          <strong>{summary.overdueTotal ?? copy.unrecorded}</strong>
          <span>
            {plural(
              summary.overdueCount,
              "{count} invoice past due",
              "{count} invoices past due",
            )}
          </span>
        </article>
        <article className={styles.summaryCard}>
          <p>{copy.oldest}</p>
          <strong>
            {summary.oldestOverdueDays === null
              ? copy.unrecorded
              : copy.days(summary.oldestOverdueDays)}
          </strong>
          <span>{copy.priorityBody}</span>
        </article>
      </section>

      {summary.excludedByCurrency > 0 ? (
        <div className={styles.warningNotice} role="note">
          <strong>{copy.mixedCurrency(summary.excludedByCurrency)}</strong>
        </div>
      ) : null}

      <section className={styles.section} aria-labelledby="collections-table">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="collections-table">{copy.tableHeading}</h2>
            <p>{copy.tableSubheading}</p>
          </div>
          <span className={styles.sectionMeta}>
            {plural(cases.length, "{count} result", "{count} results")} ·{" "}
            {copy.priorityTitle.toLocaleLowerCase()}
          </span>
        </header>
        {cases.length === 0 ? (
          <p className={styles.empty}>{copy.empty}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={copy.caption}
            captionHidden
            density="compact"
            headers={[
              "Priority / invoice",
              "Amount",
              "Age",
              "Status",
              "Next action",
              correctionCopy.heading,
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
              <strong>{entry.amount ?? copy.unrecorded}</strong>,
              entry.overdueDays === null
                ? copy.unrecorded
                : copy.days(entry.overdueDays),
              <>
                <StatusBadge tone={riskTone(entry)}>
                  {entry.statusLabel}
                </StatusBadge>
                <div className={styles.secondary}>
                  {entry.dueLabel ?? copy.unrecorded}
                </div>
              </>,
              entry.nextAction ?? copy.unrecorded,
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
