"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useId, useState, type ReactNode } from "react";

import type { SelectOption } from "./data";
import { adminSafetyCopy } from "./copy";
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
  hint = adminSafetyCopy.selectorHint,
  required = true,
}: {
  label: string;
  name: string;
  options: readonly SelectOption[];
  value: string;
  onChange: (id: string) => void;
  hint?: string;
  required?: boolean;
}) {
  const inputId = useId();
  const listId = useId();
  const hintId = useId();
  const selected = options.find((option) => option.id === value);
  const display = (option: SelectOption) =>
    option.description
      ? `${option.label} — ${option.description}`
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
        {hint}
      </p>
    </div>
  );
}

export function TechnicalEvidence({
  identifiers,
  label = adminSafetyCopy.technicalEvidence,
}: {
  identifiers: readonly EvidenceIdentifier[];
  label?: string;
}) {
  const disclosed = disclosedIdentifiers(identifiers);
  if (disclosed.length === 0) return null;
  return (
    <details className={styles.technical}>
      <summary>{label}</summary>
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
  title = adminSafetyCopy.reviewSummary,
  identifiers = [],
}: {
  summary: ReviewSummary;
  title?: string;
  identifiers?: readonly EvidenceIdentifier[];
}) {
  return (
    <section className={styles.summary} aria-labelledby="review-summary-title">
      <h3 id="review-summary-title">{title}</h3>
      <dl>
        <div>
          <dt>{adminSafetyCopy.reviewLabels.entity}</dt>
          <dd>{summary.entity}</dd>
        </div>
        <div>
          <dt>{adminSafetyCopy.reviewLabels.impact}</dt>
          <dd>{summary.impact}</dd>
        </div>
        <div>
          <dt>{adminSafetyCopy.reviewLabels.evidence}</dt>
          <dd>
            <ul>
              {summary.evidence.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt>{adminSafetyCopy.reviewLabels.policy}</dt>
          <dd>{summary.policyBasis}</dd>
        </div>
        <div>
          <dt>{adminSafetyCopy.reviewLabels.downstream}</dt>
          <dd>{summary.downstreamEffect}</dd>
        </div>
        <div>
          <dt>{adminSafetyCopy.reviewLabels.reason}</dt>
          <dd>{summary.reason}</dd>
        </div>
      </dl>
      <TechnicalEvidence identifiers={identifiers} />
    </section>
  );
}

export function StatusPill({ state }: { state: string }) {
  const normalized = state.toLowerCase();
  const tone = ["active", "complete", "approved", "passed"].some((part) =>
    normalized.includes(part),
  )
    ? styles.success
    : ["blocked", "retired", "failed"].some((part) => normalized.includes(part))
      ? styles.danger
      : styles.warning;
  return <span className={`${styles.pill} ${tone}`}>{state}</span>;
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
