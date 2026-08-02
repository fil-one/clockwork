"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";

import { Button, EmptyState } from "@clockwork/ui";

import { plural } from "@/src/i18n/en";

import styles from "./queue-search.module.css";
import { SEARCH_COPY } from "./copy";
import {
  groupSearchResults,
  nextSearchIndex,
  searchRecords,
  type SearchRecord,
} from "./search-model";

export function GlobalSearch({
  records,
}: {
  records: readonly SearchRecord[];
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const query = searchParams.get("q") ?? "";
  const [draft, setDraft] = useState(query);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isPending, startTransition] = useTransition();
  const linkRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const results = useMemo(
    () => searchRecords(query, records),
    [query, records],
  );
  const groups = useMemo(() => groupSearchResults(results), [results]);

  useEffect(() => setDraft(query), [query]);
  useEffect(() => {
    setActiveIndex(-1);
    linkRefs.current = [];
  }, [query]);

  function commit(value: string) {
    const next = new URLSearchParams();
    if (value.trim()) next.set("q", value.trim());
    startTransition(() =>
      router.replace(`${pathname}${next.size ? `?${next}` : ""}` as Route, {
        scroll: false,
      }),
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Enter" &&
      event.key !== "Escape"
    )
      return;
    if (event.key === "Escape") {
      setActiveIndex(-1);
      return;
    }
    if (event.key === "Enter") {
      if (activeIndex >= 0) linkRefs.current[activeIndex]?.click();
      else commit(draft);
      return;
    }
    event.preventDefault();
    const next = nextSearchIndex(activeIndex, event.key, results.length);
    setActiveIndex(next);
    linkRefs.current[next]?.focus();
  }

  let resultIndex = -1;
  return (
    <main className={styles.searchPage} id="main-content">
      <header className={styles.searchHeader}>
        <p className={styles.eyebrow}>{SEARCH_COPY.eyebrow}</p>
        <h1>{SEARCH_COPY.title}</h1>
        <p>{SEARCH_COPY.description}</p>
        <form
          className={styles.searchForm}
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            commit(draft);
          }}
        >
          <label htmlFor="global-search">{SEARCH_COPY.label}</label>
          <div>
            <input
              id="global-search"
              type="search"
              autoComplete="off"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              aria-controls="global-search-results"
              aria-activedescendant={
                activeIndex >= 0 ? `search-result-${activeIndex}` : undefined
              }
              placeholder={SEARCH_COPY.placeholder}
              autoFocus
            />
            <button type="submit">{SEARCH_COPY.action}</button>
          </div>
          <p>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {SEARCH_COPY.keyboardHelp}
          </p>
        </form>
      </header>

      {isPending ? (
        <p className={styles.searchProgress} role="status">
          {SEARCH_COPY.searching}
        </p>
      ) : null}
      {!query ? (
        <section
          className={styles.searchWelcome}
          aria-labelledby="search-scope-title"
        >
          <h2 id="search-scope-title">{SEARCH_COPY.scopeTitle}</h2>
          <p>{SEARCH_COPY.scopeDescription}</p>
          <ul>
            {SEARCH_COPY.scope.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : results.length === 0 ? (
        <EmptyState
          title={`No results for “${query}”`}
          description="Check the spelling, use fewer terms, or search a known entity name instead of an identifier."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setDraft("");
                commit("");
              }}
            >
              {SEARCH_COPY.clear}
            </Button>
          }
        />
      ) : (
        <section
          id="global-search-results"
          className={styles.searchResults}
          aria-label={SEARCH_COPY.resultsLabel}
        >
          <div className={styles.searchResultCount} aria-live="polite">
            <strong>
              {plural(results.length, "{count} result", "{count} results")}
            </strong>
            <span>{SEARCH_COPY.grouped}</span>
          </div>
          {groups.map((entry) => (
            <section
              className={styles.searchGroup}
              key={entry.group}
              aria-labelledby={`search-group-${entry.group.replaceAll(" ", "-")}`}
            >
              <h2 id={`search-group-${entry.group.replaceAll(" ", "-")}`}>
                {entry.group}
                <span className={styles.groupCount} aria-hidden="true">
                  {entry.results.length}
                </span>
                <span className="sr-only">
                  {plural(
                    entry.results.length,
                    "{count} result",
                    "{count} results",
                  )}
                </span>
              </h2>
              <ul>
                {entry.results.map((record) => {
                  resultIndex += 1;
                  const index = resultIndex;
                  return (
                    <li
                      key={`${record.group}-${record.id}`}
                      className={
                        activeIndex === index ? styles.activeResult : undefined
                      }
                    >
                      <div>
                        <Link
                          id={`search-result-${index}`}
                          ref={(node) => {
                            linkRefs.current[index] = node;
                          }}
                          href={record.href as Route}
                          onFocus={() => setActiveIndex(index)}
                          onKeyDown={onKeyDown}
                        >
                          {record.title}
                        </Link>
                        <p>{record.subtitle}</p>
                      </div>
                      <div className={styles.searchMeta}>
                        <span>{record.status}</span>
                        <details>
                          <summary>{SEARCH_COPY.reference}</summary>
                          <code>{record.id}</code>
                        </details>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </section>
      )}
    </main>
  );
}
