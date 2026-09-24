"use client";

import type { SelectorOption } from "./workflow-model";
import styles from "./commercial.module.css";

export function SearchableSelector({
  id,
  label,
  value,
  options,
  error,
  help,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly SelectorOption[];
  error?: string | undefined;
  help?: string | undefined;
  /** The whole prompt, in the reader's language ("Search offer"). */
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const listId = `${id}-options`;
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  return (
    <div className={styles.selector} data-field={id}>
      <label htmlFor={id}>{label}</label>
      <input
        aria-describedby={error ? errorId : help ? helpId : undefined}
        aria-invalid={Boolean(error) || undefined}
        autoComplete="off"
        id={id}
        list={listId}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        value={value}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.id} value={option.label}>
            {option.description}
          </option>
        ))}
      </datalist>
      {help ? (
        <span className={styles.muted} id={helpId}>
          {help}
        </span>
      ) : null}
      {error ? (
        <p className={styles.fieldError} id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
