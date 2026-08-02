"use client";

import { useState } from "react";

import { Button, Input, StatusBadge } from "@clockwork/ui";

import { lifecycleCopy } from "./copy";
import {
  migrations,
  type MigrationCandidate,
  type MigrationRecord,
} from "./lifecycle-data";
import { resolveMigration } from "./lifecycle-logic";
import { FinancePageFrame } from "./page-frame";
import { ReviewAction } from "./review-action";
import styles from "./finance-lifecycle.module.css";

function candidateLabel(candidate: MigrationCandidate): string {
  return `${candidate.name} · ${candidate.detail}`;
}

function MigrationCard({ record }: { record: MigrationRecord }) {
  const initialCandidate =
    record.candidates.length === 1 ? record.candidates[0] : undefined;
  const [query, setQuery] = useState(
    initialCandidate ? candidateLabel(initialCandidate) : "",
  );
  const [confirmed, setConfirmed] = useState(false);
  const selectedCandidate = record.candidates.find(
    (candidate) => candidateLabel(candidate) === query,
  );
  const selectedId = selectedCandidate?.id ?? "";
  const resolution = resolveMigration(record, selectedId, confirmed);
  const listId = `${record.id}-candidates`;
  const ambiguous = record.candidates.length > 1;

  return (
    <article className={styles.migrationCard}>
      <header className={styles.migrationHeading}>
        <div>
          <h2>{record.sourceName}</h2>
          <p>
            {record.legalEntity} · {record.sourceSystem}
          </p>
        </div>
        <StatusBadge
          tone={
            ambiguous
              ? "danger"
              : record.candidates.length
                ? "success"
                : "warning"
          }
        >
          {ambiguous
            ? `${record.candidates.length} possible matches`
            : record.candidates.length === 1
              ? "Single candidate"
              : "No candidate"}
        </StatusBadge>
      </header>

      {record.candidates.length > 0 ? (
        <ul
          className={styles.candidateList}
          aria-label="Candidate match confidence"
        >
          {record.candidates.map((candidate) => (
            <li key={candidate.id}>
              <span>
                <strong>{candidate.name}</strong>
                {candidate.detail}
              </span>
              <strong>{candidate.confidence}%</strong>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.empty}>
          No current account matched the verified legal name or domain.
        </div>
      )}

      <div>
        <Input
          label="Search and select an account"
          name={`${record.id}-account-label`}
          type="search"
          list={listId}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setConfirmed(false);
          }}
          placeholder={
            record.candidates.length
              ? "Type an account name, route, or domain"
              : "No candidate account available"
          }
          help={
            ambiguous
              ? "Choose one verified legal entity. Selecting a candidate links the source record; it never creates another account."
              : record.candidates.length
                ? "The submitted value remains the selected account ID."
                : "A new-account request is available only after evidence review."
          }
          disabled={record.candidates.length === 0}
          autoComplete="off"
        />
        <datalist id={listId}>
          {record.candidates.map((candidate) => (
            <option key={candidate.id} value={candidateLabel(candidate)} />
          ))}
        </datalist>
        <input
          type="hidden"
          name={`${record.id}-targetAccountId`}
          value={selectedId}
        />
      </div>

      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.currentTarget.checked)}
        />
        <span>
          I compared the legal name, route, verified domain, and source
          evidence. This confirmation and my server-attributed identity will be
          retained.
        </span>
      </label>

      <details className={styles.disclosure}>
        <summary>Evidence and technical identifiers</summary>
        <p>{record.evidence}</p>
        <p>
          Migration: <span className={styles.id}>{record.id}</span>
          <br />
          Source reference:{" "}
          <span className={styles.id}>{record.externalReference}</span>
          {selectedId ? (
            <>
              <br />
              Submitted account ID:{" "}
              <span className={styles.id}>{selectedId}</span>
            </>
          ) : null}
        </p>
      </details>

      <footer className={styles.migrationFooter}>
        <p className={resolution.allowed ? styles.safe : styles.blocked}>
          {resolution.reason}
        </p>
        {resolution.allowed ? (
          <ReviewAction
            triggerLabel={
              resolution.action === "link"
                ? "Review account link"
                : "Review new account"
            }
            confirmLabel="Complete migration review"
            summary={{
              action:
                resolution.action === "link"
                  ? "Link migrated record to existing account"
                  : "Request a new account from migration evidence",
              entity:
                resolution.action === "link" && selectedCandidate
                  ? `${record.sourceName} → ${selectedCandidate.name}`
                  : record.legalEntity,
              impact:
                resolution.action === "link"
                  ? "The source record will reference the verified current account. No account is created."
                  : "A separately gated account-creation request will be staged; creation is not automatic.",
              evidence: record.evidence,
              policyBasis:
                "Migration identity policy §3 · verified legal entity and explicit ambiguity resolution",
              downstreamEffect:
                resolution.action === "link"
                  ? "Orders and invoices remain on the existing account after reconciliation."
                  : "Screening and credit gates run before any account becomes available.",
              technicalId: `${record.id} · source ${record.externalReference}${selectedId ? ` · account ${selectedId}` : ""}`,
              actorAuthority:
                "Internal operator may stage the review; the server authorizes linking or creation and records the actor.",
            }}
          />
        ) : (
          <Button
            variant="secondary"
            size="small"
            disabled
            title={resolution.reason}
          >
            Review blocked
          </Button>
        )}
      </footer>
    </article>
  );
}

export function MigrationsView() {
  const ambiguousCount = migrations.filter(
    (record) => record.candidates.length > 1,
  ).length;
  const newAccountReviews = migrations.filter(
    (record) => record.candidates.length === 0,
  ).length;

  return (
    <FinancePageFrame
      title={lifecycleCopy.migrations.title}
      description={lifecycleCopy.migrations.description}
      freshness={lifecycleCopy.migrations.freshness}
      source={lifecycleCopy.migrations.source}
    >
      <section
        className={styles.summaryGrid}
        aria-label="Migration matching state"
      >
        <article className={styles.summaryCard}>
          <p>Records awaiting review</p>
          <strong>{migrations.length}</strong>
          <span>Human evidence confirmation required</span>
        </article>
        <article className={styles.summaryCard}>
          <p>Ambiguous matches</p>
          <strong>{ambiguousCount}</strong>
          <span>Duplicate account creation is blocked</span>
        </article>
        <article className={styles.summaryCard}>
          <p>No-match records</p>
          <strong>{newAccountReviews}</strong>
          <span>New-account review plus screening and credit gates</span>
        </article>
      </section>

      <div className={styles.warningNotice} role="note">
        <strong>Ambiguity never creates an account.</strong>
        <span>
          Search by a human-readable name, route, or domain. Clockwork retains
          the selected account ID only after an exact candidate is chosen and
          reviewed.
        </span>
      </div>

      <section
        aria-label="Migration candidates"
        className={styles.migrationGrid}
      >
        {migrations.map((record) => (
          <MigrationCard key={record.id} record={record} />
        ))}
      </section>
    </FinancePageFrame>
  );
}
