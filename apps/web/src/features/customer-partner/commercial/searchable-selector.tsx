"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "@/src/i18n/client";

import type { SelectorOption } from "./workflow-model";
import styles from "./commercial.module.css";

/** A visible listbox also works in browsers that do not expose native datalists. */
export function SearchableSelector({
  id,
  name,
  label,
  value,
  options,
  error,
  help,
  placeholder,
  onChange,
}: {
  id: string;
  name?: string;
  label: string;
  value: string;
  options: readonly SelectorOption[];
  error?: string | undefined;
  help?: string | undefined;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = `${id}-options`;
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const results = options.filter((option) =>
    `${option.label} ${option.description ?? ""}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const active = results[activeIndex];
  const choose = (option: SelectorOption) => {
    onChange(option.label);
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  };

  useEffect(() => {
    if (open && active)
      listRef.current?.children[activeIndex]?.scrollIntoView?.({
        block: "nearest",
      });
  }, [open, active, activeIndex]);

  return (
    <div className={styles.selector} data-field={id}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.selectorControl}>
        <input
          aria-describedby={
            [help ? helpId : undefined, error ? errorId : undefined]
              .filter(Boolean)
              .join(" ") || undefined
          }
          aria-invalid={Boolean(error) || undefined}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={
            open && active ? `${listId}-${activeIndex}` : undefined
          }
          role="combobox"
          autoComplete="off"
          id={id}
          name={name}
          onFocus={() => {
            setQuery("");
            setActiveIndex(-1);
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            onChange(event.target.value);
            setQuery(event.target.value);
            setActiveIndex(-1);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && open) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              const direction = event.key === "ArrowDown" ? 1 : -1;
              setActiveIndex((current) =>
                results.length
                  ? current < 0
                    ? direction > 0
                      ? 0
                      : results.length - 1
                    : (current + direction + results.length) % results.length
                  : -1,
              );
            } else if (event.key === "Enter" && open) {
              event.preventDefault();
              const option = active ?? results[0];
              if (option) choose(option);
            }
          }}
          placeholder={placeholder}
          type="text"
          value={value}
        />
        {open ? (
          <div className={styles.selectorPopover}>
            <ul id={listId} ref={listRef} role="listbox" aria-label={label}>
              {results.map((option, index) => (
                <li
                  id={`${listId}-${index}`}
                  key={option.id}
                  role="option"
                  aria-selected={value === option.label}
                  data-active={activeIndex === index || undefined}
                  onPointerDown={(event) => event.preventDefault()}
                  onPointerMove={() => setActiveIndex(index)}
                  onClick={() => choose(option)}
                >
                  <strong>{option.label}</strong>
                  {option.description ? (
                    <span>{option.description}</span>
                  ) : null}
                </li>
              ))}
            </ul>
            {!results.length ? (
              <p role="status">{t("common.noResults")}</p>
            ) : null}
          </div>
        ) : null}
      </div>
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
