"use client";
import type { Translator } from "@/src/i18n";
import {
  useFormattingLocale,
  useLocale,
  useTranslations,
} from "@/src/i18n/client";
import { resolveDemoText } from "@clockwork/testing/demo-localized-text";

import { useState } from "react";

import { Button, Input, StatusBadge } from "@clockwork/ui";

import { lifecycleCopy } from "./copy";
import type { DemoMigrationDecision } from "../demo-operator-state";
import {
  illustrativeMigrations,
  type MigrationCandidate,
  type MigrationRecord,
} from "./lifecycle-data";
import {
  resolveMigration,
  type MigrationResolution,
  type ReviewSummary,
} from "./lifecycle-logic";
import { FinancePageFrame, IdentifierLine } from "./page-frame";
import { formatCount } from "./projection-fields";
import { ReviewAction } from "./review-action";
import { MigrationDecisionAction } from "./migration-decision-action";
import styles from "./finance-lifecycle.module.css";

const copy = lifecycleCopy.migrations;

/** The candidate's country, relationship and verified domain on one line. */
function candidateDetail(t: Translator, candidate: MigrationCandidate): string {
  return t("common.join.labels", {
    first: candidate.country,
    second: t("common.join.labels", {
      first: t(copy.relationships[candidate.relationship]),
      second: candidate.domain,
    }),
  });
}

/**
 * What the operator types or picks in the account search. It is compared
 * within one render, in one language, so the localized relationship in it
 * never has to match across languages.
 */
function candidateLabel(t: Translator, candidate: MigrationCandidate): string {
  return t("common.join.labels", {
    first: candidate.name,
    second: candidateDetail(t, candidate),
  });
}

function resolutionText(
  t: Translator,
  resolution: MigrationResolution,
  candidate: MigrationCandidate | undefined,
): string {
  if (resolution.reason === "readyToLink" && candidate)
    return t(copy.reasons.readyToLink, { account: candidate.name });
  if (resolution.reason === "readyToLink") return t(copy.reasons.selectAccount);
  return t(copy.reasons[resolution.reason]);
}

function MigrationCard({
  record,
  decision,
  guidedDemo,
}: {
  record: MigrationRecord;
  decision?: DemoMigrationDecision;
  guidedDemo: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const formattingLocale = useFormattingLocale();
  const initialCandidate =
    record.candidates.length === 1 ? record.candidates[0] : undefined;
  const [query, setQuery] = useState(
    initialCandidate ? candidateLabel(t, initialCandidate) : "",
  );
  const [confirmed, setConfirmed] = useState(false);
  const selectedCandidate = record.candidates.find(
    (candidate) => candidateLabel(t, candidate) === query,
  );
  const selectedId = selectedCandidate?.id ?? "";
  const resolution = resolveMigration(record, selectedId, confirmed);
  const reason = resolutionText(t, resolution, selectedCandidate);
  const listId = `${record.id}-candidates`;
  const ambiguous = record.candidates.length > 1;
  const resolved = Boolean(decision);
  const evidence = resolveDemoText(record.evidence, locale);
  const sourceSystem = resolveDemoText(record.sourceSystem, locale);
  const percent = new Intl.NumberFormat(formattingLocale, { style: "percent" });

  const link = resolution.action === "link";
  const summary: ReviewSummary = {
    action: t(link ? copy.review.linkAction : copy.review.createAction),
    entity:
      link && selectedCandidate
        ? t(copy.review.linkEntity, {
            source: record.sourceName,
            target: selectedCandidate.name,
          })
        : record.legalEntity,
    impact: t(link ? copy.review.linkImpact : copy.review.createImpact),
    evidence,
    policyBasis: t(copy.review.policyBasis),
    downstreamEffect: t(
      link ? copy.review.linkDownstream : copy.review.createDownstream,
    ),
    technicalId: selectedId
      ? t(copy.review.technicalIdWithAccount, {
          migration: record.id,
          source: record.externalReference,
          account: selectedId,
        })
      : t(copy.review.technicalId, {
          migration: record.id,
          source: record.externalReference,
        }),
    actorAuthority: t(copy.review.actorAuthority),
  };
  const triggerLabel = t(
    link ? copy.review.linkTrigger : copy.review.createTrigger,
  );

  return (
    <article className={styles.migrationCard}>
      <header className={styles.migrationHeading}>
        <div>
          <h2>{record.sourceName}</h2>
          <p>
            {t("common.join.labels", {
              first: record.legalEntity,
              second: sourceSystem,
            })}
          </p>
        </div>
        <StatusBadge
          tone={
            resolved
              ? "success"
              : ambiguous
                ? "danger"
                : record.candidates.length
                  ? "success"
                  : "warning"
          }
        >
          {resolved
            ? t(copy.badge.decided)
            : ambiguous
              ? t(copy.badge.possibleMatches, {
                  count: record.candidates.length,
                })
              : record.candidates.length === 1
                ? t(copy.badge.single)
                : t(copy.badge.none)}
        </StatusBadge>
      </header>

      {record.candidates.length > 0 ? (
        <ul
          className={styles.candidateList}
          aria-label={t(copy.confidenceLabel)}
        >
          {record.candidates.map((candidate) => (
            <li key={candidate.id}>
              <span>
                <strong>{candidate.name}</strong>
                {candidateDetail(t, candidate)}
              </span>
              <strong>{percent.format(candidate.confidence / 100)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.empty}>{t(copy.noMatch)}</div>
      )}

      <div>
        <Input
          label={t(copy.search.label)}
          name={`${record.id}-account-label`}
          type="search"
          list={listId}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setConfirmed(false);
          }}
          placeholder={t(
            record.candidates.length
              ? copy.search.placeholder
              : copy.search.placeholderEmpty,
          )}
          help={t(
            ambiguous
              ? copy.search.helpAmbiguous
              : record.candidates.length
                ? copy.search.helpSingle
                : copy.search.helpNone,
          )}
          disabled={record.candidates.length === 0 || resolved}
          autoComplete="off"
        />
        <datalist id={listId}>
          {record.candidates.map((candidate) => (
            <option key={candidate.id} value={candidateLabel(t, candidate)} />
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
          disabled={resolved}
          onChange={(event) => setConfirmed(event.currentTarget.checked)}
        />
        <span>{t(copy.attestation)}</span>
      </label>

      <details className={styles.disclosure}>
        <summary>{t(copy.evidenceSummary)}</summary>
        <p>{evidence}</p>
        <IdentifierLine label={copy.ids.migration} value={record.id} />
        <IdentifierLine
          label={copy.ids.sourceReference}
          value={record.externalReference}
        />
        {selectedId ? (
          <IdentifierLine
            label={copy.ids.submittedAccount}
            value={selectedId}
          />
        ) : null}
      </details>

      <footer className={styles.migrationFooter}>
        <p
          className={
            resolved || resolution.allowed ? styles.safe : styles.blocked
          }
        >
          {decision
            ? decision.action === "link"
              ? t(copy.decision.linked, {
                  account: decision.targetAccountId ?? "",
                  version: String(decision.version),
                })
              : t(copy.decision.staged, { version: String(decision.version) })
            : reason}
        </p>
        {decision ? null : resolution.allowed ? (
          guidedDemo ? (
            <MigrationDecisionAction
              migrationId={record.id}
              targetAccountId={selectedId}
              triggerLabel={triggerLabel}
              summary={summary}
            />
          ) : (
            <ReviewAction
              triggerLabel={triggerLabel}
              confirmLabel={t(copy.review.confirm)}
              summary={summary}
            />
          )
        ) : (
          <Button variant="secondary" size="small" disabled title={reason}>
            {t(copy.review.blocked)}
          </Button>
        )}
      </footer>
    </article>
  );
}

export function MigrationsView({
  guidedDemo = false,
  decisions = [],
}: {
  guidedDemo?: boolean;
  decisions?: readonly DemoMigrationDecision[];
}) {
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
  const ambiguousCount = illustrativeMigrations.filter(
    (record) => record.candidates.length > 1,
  ).length;
  const newAccountReviews = illustrativeMigrations.filter(
    (record) => record.candidates.length === 0,
  ).length;

  return (
    <FinancePageFrame
      title={t(copy.title)}
      description={t(copy.description)}
      provenance={
        guidedDemo
          ? { kind: "guided" }
          : { kind: "unwired", detail: t(copy.unwired) }
      }
    >
      <div className={styles.notice} role="note">
        <strong>{t(copy.illustrativeTitle)}</strong>
        <span>{t(copy.illustrativeBody)}</span>
      </div>

      <section className={styles.summaryGrid} aria-label={t(copy.summaryLabel)}>
        <article className={styles.summaryCard}>
          <p>{t(copy.cards.toReview)}</p>
          <strong>
            {formatCount(illustrativeMigrations.length, formattingLocale)}
          </strong>
          <span>{t(copy.cards.toReviewDetail)}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{t(copy.cards.ambiguous)}</p>
          <strong>{formatCount(ambiguousCount, formattingLocale)}</strong>
          <span>{t(copy.cards.ambiguousDetail)}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{t(copy.cards.noMatch)}</p>
          <strong>{formatCount(newAccountReviews, formattingLocale)}</strong>
          <span>{t(copy.cards.noMatchDetail)}</span>
        </article>
      </section>

      <div className={styles.warningNotice} role="note">
        <strong>{t(copy.ambiguityTitle)}</strong>
        <span>{t(copy.ambiguityBody)}</span>
      </div>

      <section
        aria-label={t(copy.candidatesLabel)}
        className={styles.migrationGrid}
      >
        {illustrativeMigrations.map((record) => {
          const decision = decisions.find(
            (candidate) => candidate.migrationId === record.id,
          );
          return (
            <MigrationCard
              key={record.id}
              record={record}
              guidedDemo={guidedDemo}
              {...(decision ? { decision } : {})}
            />
          );
        })}
      </section>
    </FinancePageFrame>
  );
}
