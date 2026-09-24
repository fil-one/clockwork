"use client";
import { useTranslations } from "@/src/i18n/client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useId, useState, type ReactNode } from "react";

import type { SelectOption } from "./data";
import { adminSafetyCopy, type StatusTone } from "./copy";
import {
  disclosedIdentifiers,
  type EvidenceIdentifier,
  type ReviewSummary,
} from "./policy";
import styles from "./administration-safety.module.css";

export function AdministrationPage({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <div className={styles.headerText}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1>{title}</h1>
          <p className={styles.description}>{description}</p>
        </div>
        {actions ? <div className={styles.headerActions}>{actions}</div> : null}
      </header>
      {children}
    </main>
  );
}

export function HumanSelector({
  label,
  name,
  options,
  value,
  onChange,
  hint,
  required = true,
}: {
  label: string;
  name: string;
  options: readonly SelectOption[];
  value: string;
  onChange: (id: string) => void;
  /** Replaces the standard hint; omit it to show that hint. */
  hint?: string;
  required?: boolean;
}) {
  const t = useTranslations();
  const inputId = useId();
  const listId = useId();
  const hintId = useId();
  const selected = options.find((option) => option.id === value);
  const display = (option: SelectOption) =>
    option.description
      ? `${option.label} · ${option.description}`
      : option.label;
  const [query, setQuery] = useState(selected ? display(selected) : "");

  useEffect(() => {
    const next = options.find((option) => option.id === value);
    setQuery(next ? display(next) : "");
  }, [options, value]);

  return (
    <div className={styles.selector}>
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type="search"
        list={listId}
        value={query}
        aria-describedby={hintId}
        autoComplete="off"
        required={required}
        onChange={(event) => {
          const nextQuery = event.currentTarget.value;
          setQuery(nextQuery);
          const match = options.find(
            (option) =>
              display(option) === nextQuery || option.label === nextQuery,
          );
          onChange(match?.id ?? "");
        }}
        onBlur={() => {
          const current = options.find((option) => option.id === value);
          if (current) setQuery(display(current));
        }}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.id} value={display(option)} />
        ))}
      </datalist>
      <input type="hidden" name={name} value={value} />
      <p className={styles.fieldHint} id={hintId}>
        {hint ?? t(adminSafetyCopy.selectorHint)}
      </p>
    </div>
  );
}

export function TechnicalEvidence({
  identifiers,
  label,
}: {
  identifiers: readonly EvidenceIdentifier[];
  /** Replaces the standard "Technical evidence" summary. */
  label?: string;
}) {
  const t = useTranslations();
  const disclosed = disclosedIdentifiers(identifiers);
  if (disclosed.length === 0) return null;
  return (
    <details className={styles.technical}>
      <summary>{label ?? t(adminSafetyCopy.technicalEvidence)}</summary>
      <dl>
        {disclosed.map(({ label: itemLabel, value }) => (
          <div key={`${itemLabel}-${value}`}>
            <dt>{itemLabel}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function ReviewSummaryCard({
  summary,
  title,
  identifiers = [],
}: {
  summary: ReviewSummary;
  /** Replaces the standard "Decision review summary" heading. */
  title?: string;
  identifiers?: readonly EvidenceIdentifier[];
}) {
  const t = useTranslations();
  const labels = adminSafetyCopy.reviewLabels;
  return (
    <section className={styles.summary} aria-labelledby="review-summary-title">
      <h3 id="review-summary-title">
        {title ?? t(adminSafetyCopy.reviewSummary)}
      </h3>
      <dl>
        <div>
          <dt>{t(labels.entity)}</dt>
          <dd>{summary.entity}</dd>
        </div>
        <div>
          <dt>{t(labels.impact)}</dt>
          <dd>{summary.impact}</dd>
        </div>
        <div>
          <dt>{t(labels.evidence)}</dt>
          <dd>
            <ul>
              {summary.evidence.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt>{t(labels.policy)}</dt>
          <dd>{summary.policyBasis}</dd>
        </div>
        <div>
          <dt>{t(labels.downstream)}</dt>
          <dd>{summary.downstreamEffect}</dd>
        </div>
        <div>
          <dt>{t(labels.reason)}</dt>
          <dd>{summary.reason}</dd>
        </div>
      </dl>
      <TechnicalEvidence identifiers={identifiers} />
    </section>
  );
}

export type { StatusTone };

/**
 * A status chip. Its colour comes from `tone`, which the caller derives from
 * the record's state, never from the label: the label is translated, so no
 * word in it can be trusted to mean anything. Without `tone` the chip is
 * neutral (no colour).
 */
export function StatusPill({
  state,
  tone,
}: {
  /** The chip's label, already in the reader's language. */
  state: string;
  tone?: StatusTone;
}) {
  return (
    <span className={tone ? `${styles.pill} ${styles[tone]}` : styles.pill}>
      {state}
    </span>
  );
}

export function ExitLink({
  href,
  children,
}: {
  href: Route;
  children: ReactNode;
}) {
  return (
    <Link className={styles.exitLink} href={href}>
      {children}
    </Link>
  );
}

export { styles };
