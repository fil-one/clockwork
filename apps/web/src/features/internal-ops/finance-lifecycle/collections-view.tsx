import { StatusBadge, Table } from "@clockwork/ui";

import { plural } from "@/src/i18n/en";

import { lifecycleCopy } from "./copy";
import { collections, type DisputeState } from "./lifecycle-data";
import { formatMoney, prioritizeCollections } from "./lifecycle-logic";
import { FinancePageFrame } from "./page-frame";
import { ReviewAction } from "./review-action";
import styles from "./finance-lifecycle.module.css";

function disputeTone(state: DisputeState): "neutral" | "warning" | "danger" {
  if (state === "Under review") return "danger";
  if (state === "Evidence due") return "warning";
  return "neutral";
}

export function CollectionsView() {
  const prioritized = prioritizeCollections(collections);
  const total = prioritized.reduce(
    (sum, collection) => sum + collection.overdueCents,
    0,
  );
  const disputed = prioritized
    .filter((collection) => collection.dispute !== "No dispute")
    .reduce((sum, collection) => sum + collection.overdueCents, 0);
  const oldest = Math.max(
    ...prioritized.map((collection) => collection.ageDays),
  );

  return (
    <FinancePageFrame
      title={lifecycleCopy.collections.title}
      description={lifecycleCopy.collections.description}
      freshness={lifecycleCopy.collections.freshness}
      source={lifecycleCopy.collections.source}
    >
      <section className={styles.summaryGrid} aria-label="Collections health">
        <article className={styles.summaryCard}>
          <p>Total overdue</p>
          <strong>{formatMoney(total)}</strong>
          <span>{prioritized.length} open invoices</span>
        </article>
        <article className={styles.summaryCard}>
          <p>Protected by active dispute</p>
          <strong>{formatMoney(disputed)}</strong>
          <span>No adverse action while evidence is reviewed</span>
        </article>
        <article className={styles.summaryCard}>
          <p>Oldest open invoice</p>
          <strong>{oldest} days</strong>
          <span>Age is secondary to overdue value in this priority view</span>
        </article>
      </section>

      <div className={styles.notice} role="note">
        <strong>Priority order</strong>
        <span>
          Highest overdue value, then oldest age, dispute state, and owner.
          Active disputes remain visibly gated even when they rank highly.
        </span>
      </div>

      <section className={styles.section} aria-labelledby="collections-table">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="collections-table">Finance approval queue</h2>
            <p>Review evidence and downstream effects before any escalation.</p>
          </div>
          <span className={styles.sectionMeta}>
            {plural(prioritized.length, "{count} result", "{count} results")} ·
            priority order
          </span>
        </header>
        <Table
          className={styles.dsTable ?? ""}
          caption="Collections prioritized by overdue value, age, dispute, and owner"
          captionHidden
          density="compact"
          headers={[
            "Priority / invoice",
            "Overdue",
            "Age",
            "Dispute",
            "Owner",
            "Evidence / next action",
            "Permitted action",
          ]}
          numericColumns={[1, 2]}
          rowKeys={prioritized.map((record) => record.id)}
          rows={prioritized.map((record, index) => {
            const blockedByDispute = record.dispute !== "No dispute";
            return [
              <div className={styles.primaryCell}>
                <span className={styles.secondary}>Priority {index + 1}</span>
                <strong>{record.account}</strong>
                <span>{record.id}</span>
                <details className={styles.disclosure}>
                  <summary>Technical evidence</summary>
                  <p>
                    Account ID:{" "}
                    <span className={styles.id}>{record.accountId}</span>
                  </p>
                </details>
              </div>,
              <strong>{formatMoney(record.overdueCents)}</strong>,
              `${record.ageDays} days`,
              <StatusBadge tone={disputeTone(record.dispute)}>
                {record.dispute}
              </StatusBadge>,
              record.owner,
              <div className={styles.primaryCell}>
                <span>{record.lastContact}</span>
                <strong>{record.nextAction}</strong>
                <details className={styles.disclosure}>
                  <summary>Policy basis</summary>
                  <p>{record.policyBasis}</p>
                </details>
              </div>,
              <div className={styles.actionStack}>
                <ReviewAction
                  triggerLabel={
                    blockedByDispute
                      ? "Review evidence routing"
                      : "Review escalation"
                  }
                  confirmLabel="Complete review"
                  summary={{
                    action: blockedByDispute
                      ? "Route dispute evidence"
                      : "Stage collections escalation",
                    entity: `${record.account} · ${record.id}`,
                    impact: blockedByDispute
                      ? "Evidence moves to the dispute owner; collection action stays paused."
                      : "Finance may advance the invoice to the next policy-defined collection stage.",
                    evidence: record.lastContact,
                    policyBasis: record.policyBasis,
                    downstreamEffect: blockedByDispute
                      ? "No service, credit, or retention change."
                      : "Server rechecks credit and service-restriction gates before execution.",
                    technicalId: `${record.id} · account ${record.accountId}`,
                    actorAuthority:
                      "Finance approver permission is required; server attribution is authoritative.",
                  }}
                />
                <span
                  className={blockedByDispute ? styles.blocked : styles.safe}
                >
                  {blockedByDispute
                    ? "Adverse action blocked"
                    : "Finance review required"}
                </span>
              </div>,
            ];
          })}
        />
      </section>
    </FinancePageFrame>
  );
}
