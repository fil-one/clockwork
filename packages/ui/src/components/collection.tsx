"use client";

import { ChevronDown, Search } from "lucide-react";
import type { ChangeEvent, KeyboardEvent, ReactNode } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface CollectionToolbarProps {
  label?: string;
  searchLabel?: string;
  searchPlaceholder?: string;
  query?: string;
  defaultQuery?: string;
  onQueryChange?: (query: string) => void;
  resultCount?: number;
  resultLabel?: (count: number) => ReactNode;
  selection?: ReactNode;
  filters?: ReactNode;
  sort?: ReactNode;
  viewOptions?: ReactNode;
  actions?: ReactNode;
  loading?: boolean;
  className?: string;
}

/** Responsive search/filter/action bar for tables and record collections. */
export function CollectionToolbar({
  label = "Collection controls",
  searchLabel = "Search collection",
  searchPlaceholder = "Search",
  query,
  defaultQuery = "",
  onQueryChange,
  resultCount,
  resultLabel = (count) => `${count} ${count === 1 ? "result" : "results"}`,
  selection,
  filters,
  sort,
  viewOptions,
  actions,
  loading = false,
  className = "",
}: CollectionToolbarProps) {
  const [internalQuery, setInternalQuery] = useState(defaultQuery);
  const resolvedQuery = query ?? internalQuery;
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    if (query === undefined) setInternalQuery(next);
    onQueryChange?.(next);
  };
  return (
    <div
      className={`cw-collection-toolbar ${className}`.trim()}
      role="search"
      aria-label={label}
      aria-busy={loading || undefined}
    >
      <label className="cw-collection-toolbar__search">
        <span className="cw-sr-only">{searchLabel}</span>
        <Search aria-hidden="true" />
        <input
          type="search"
          value={resolvedQuery}
          placeholder={searchPlaceholder}
          onChange={handleChange}
        />
      </label>
      {filters || sort || viewOptions ? (
        <div className="cw-collection-toolbar__controls">
          {filters}
          {sort}
          {viewOptions}
        </div>
      ) : null}
      {selection || resultCount !== undefined ? (
        <div className="cw-collection-toolbar__status" role="status">
          {loading
            ? "Updating results"
            : (selection ??
              (resultCount === undefined ? null : resultLabel(resultCount)))}
        </div>
      ) : null}
      {actions ? (
        <div className="cw-collection-toolbar__actions">{actions}</div>
      ) : null}
    </div>
  );
}

export interface EntityComboboxOption {
  id: string;
  label: string;
  description?: string;
  meta?: string;
  keywords?: readonly string[];
  disabled?: boolean;
}

export interface EntityComboboxProps {
  options: readonly EntityComboboxOption[];
  label: ReactNode;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string, option: EntityComboboxOption) => void;
  placeholder?: string;
  emptyLabel?: string;
  help?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  className?: string;
}

function optionMatches(option: EntityComboboxOption, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [
    option.label,
    option.description,
    option.meta,
    ...(option.keywords ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase()
    .includes(normalized);
}

/** Searchable entity picker with native input semantics and listbox navigation. */
export function EntityCombobox({
  options,
  label,
  value,
  defaultValue,
  onValueChange,
  placeholder = "Search entities",
  emptyLabel = "No matching entities",
  help,
  error,
  disabled = false,
  loading = false,
  loadingLabel = "Loading entities",
  className = "",
}: EntityComboboxProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string>();
  const rootRef = useRef<HTMLDivElement>(null);
  const generatedId = useId().replaceAll(":", "");
  const inputId = `entity-${generatedId}`;
  const listId = `${inputId}-listbox`;
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const resolvedValue = value ?? internalValue;
  const selected = options.find((option) => option.id === resolvedValue);
  const results = useMemo(
    () => options.filter((option) => optionMatches(option, query)),
    [options, query],
  );
  const selectable = results.filter((option) => !option.disabled);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (open && !selectable.some((option) => option.id === activeId)) {
      setActiveId(selectable[0]?.id);
    }
  }, [activeId, open, selectable]);

  const choose = (option: EntityComboboxOption) => {
    if (option.disabled) return;
    if (value === undefined) setInternalValue(option.id);
    onValueChange?.(option.id, option);
    setQuery("");
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (!selectable.length) return;
      const current = selectable.findIndex((option) => option.id === activeId);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const start = current < 0 ? (direction > 0 ? -1 : 0) : current;
      const next = (start + direction + selectable.length) % selectable.length;
      setActiveId(selectable[next]?.id);
      return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      const option =
        selectable.find((candidate) => candidate.id === activeId) ??
        selectable[0];
      if (option) choose(option);
    }
  };

  return (
    <div
      className={`cw-entity-combobox ${error ? "cw-entity-combobox--error" : ""} ${className}`.trim()}
      ref={rootRef}
    >
      <label className="cw-field__label" htmlFor={inputId}>
        {label}
      </label>
      <div className="cw-entity-combobox__input">
        <Search aria-hidden="true" />
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            open && activeId ? `${listId}-${activeId}` : undefined
          }
          aria-describedby={
            [help ? helpId : undefined, error ? errorId : undefined]
              .filter(Boolean)
              .join(" ") || undefined
          }
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          disabled={disabled}
          value={open ? query : (selected?.label ?? "")}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
        <ChevronDown aria-hidden="true" />
      </div>
      {help ? (
        <span className="cw-help" id={helpId}>
          {help}
        </span>
      ) : null}
      {error ? (
        <span className="cw-field__error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
      {open ? (
        <div
          className="cw-entity-combobox__list"
          id={listId}
          role={!loading && results.length ? "listbox" : undefined}
        >
          {loading ? (
            <div className="cw-entity-combobox__empty" role="status">
              {loadingLabel}
            </div>
          ) : results.length ? (
            results.map((option) => (
              <button
                id={`${listId}-${option.id}`}
                key={option.id}
                type="button"
                role="option"
                aria-selected={option.id === resolvedValue}
                data-active={option.id === activeId || undefined}
                disabled={option.disabled}
                tabIndex={-1}
                onPointerDown={(event) => event.preventDefault()}
                onPointerMove={() => {
                  if (!option.disabled) setActiveId(option.id);
                }}
                onClick={() => choose(option)}
              >
                <span>
                  <strong>{option.label}</strong>
                  {option.description ? (
                    <small>{option.description}</small>
                  ) : null}
                </span>
                {option.meta ? <small>{option.meta}</small> : null}
              </button>
            ))
          ) : (
            <div className="cw-entity-combobox__empty" role="status">
              {emptyLabel}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
