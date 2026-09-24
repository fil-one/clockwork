"use client";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";

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

import type { Translator } from "@/src/i18n";
import { richText } from "@/src/i18n/rich";

import { formatOperationalTimestamp } from "../presentation";
import styles from "./queue-search.module.css";
import { codeLabel, recordStatusLabels, searchGroupLabels } from "./copy";
import {
  groupSearchResults,
  nextSearchIndex,
  searchRecords,
  type SearchRecord,
} from "./search-model";

/** The status a result shows: the source's wording, else its status code named. */
function statusText(record: SearchRecord, t: Translator): string {
  if (record.statusLabel) return record.statusLabel;
  if (record.status) return codeLabel(recordStatusLabels, record.status, t);
  return t("operations.search.status.available");
}

function DetailLine({ record }: { record: SearchRecord }) {
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
  const { detail } = record;
  if (detail.kind === "text") return <p>{detail.text}</p>;
  if (detail.kind === "context")
    return (
      <p>
        {detail.entries
          .map(({ label, value }) =>
            t("operations.search.contextEntry", { label, value }),
          )
          .join(" · ")}
      </p>
    );
  return (
    <p>
      {t("common.updatedAt", {
        time: formatOperationalTimestamp(detail.at, formattingLocale),
      })}
    </p>
  );
}

export function GlobalSearch({
  records,
}: {
  records: readonly SearchRecord[];
}) {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const query = searchParams.get("q") ?? "";
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isPending, startTransition] = useTransition();
  const linkRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousQuery = useRef(query);
  const submittedQueries = useRef(new Set<string>());
  const latestSubmittedQuery = useRef<string | null>(null);
  const results = useMemo(
    () =>
      searchRecords(query, records, (record) =>
        [t(searchGroupLabels[record.group]), statusText(record, t)].join(" "),
      ),
    [query, records, t],
  );
  const groups = useMemo(() => groupSearchResults(results), [results]);

  useEffect(() => {
    if (previousQuery.current === query) return;
    previousQuery.current = query;
    // A completed search must not erase typing for the next search. A URL
    // change from elsewhere (including back/forward) replaces the field.
    if (submittedQueries.current.delete(query)) {
      if (latestSubmittedQuery.current === query) {
        submittedQueries.current.clear();
        latestSubmittedQuery.current = null;
      }
      return;
    }
    submittedQueries.current.clear();
    latestSubmittedQuery.current = null;
    if (inputRef.current) inputRef.current.value = query;
  }, [query]);
  /**
   * A new query means no active result. The ref array is truncated rather than
   * emptied: React attaches these refs during the commit that precedes this
   * effect, so discarding the array here threw away the refs for the results
   * that had just rendered, and the arrow keys moved no focus at all until
   * some other state change happened to re-attach them. On a freshly loaded
   * result page that meant the first arrow press did nothing.
   */
  useEffect(() => {
    setActiveIndex(-1);
    linkRefs.current.length = results.length;
  }, [query, results.length]);

  function commit(value: string) {
    const next = new URLSearchParams();
    const submitted = value.trim();
    if (submitted !== query) {
      submittedQueries.current.add(submitted);
      latestSubmittedQuery.current = submitted;
    } else {
      submittedQueries.current.clear();
      latestSubmittedQuery.current = null;
    }
    if (submitted) next.set("q", submitted);
    startTransition(() =>
      router.replace(`${pathname}${next.size ? `?${next}` : ""}` as Route, {
        scroll: false,
      }),
    );
  }

  /**
   * Results move real focus.
   *
   * This handler used to run two mutually exclusive patterns at once: it moved
   * DOM focus onto the result link and also pointed `aria-activedescendant` at
   * it from the input. Assistive technology reads one or the other, so the two
   * disagreed about where the user was, and `aria-activedescendant` was the
   * wrong half to keep. It describes a virtual cursor inside a combobox whose
   * options the input owns, and these results are not options: each is a link
   * inside a grouped list, alongside a status and an expandable reference that
   * the option role forbids. Real focus is what the pattern calls for when the
   * results are ordinary interactive content, so real focus is what is left.
   */
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Escape"
    )
      return;
    if (event.key === "Escape") {
      setActiveIndex(-1);
      // Focus lives on a result, so leaving it there after dismissing the
      // active result would strand the keyboard away from the field.
      inputRef.current?.focus();
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
        <p className={styles.eyebrow}>{t("operations.eyebrow")}</p>
        <h1>{t("operations.search.title")}</h1>
        <p>{t("operations.search.description")}</p>
        <form
          className={styles.searchForm}
          role="search"
          action={pathname}
          method="get"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("q");
            commit(typeof value === "string" ? value : "");
          }}
        >
          <label htmlFor="global-search">{t("operations.search.label")}</label>
          <div>
            <input
              id="global-search"
              name="q"
              ref={inputRef}
              type="search"
              autoComplete="off"
              defaultValue={query}
              onKeyDown={onKeyDown}
              aria-controls="global-search-results"
              placeholder={t("operations.search.placeholder")}
              autoFocus
            />
            <button type="submit">{t("common.search")}</button>
          </div>
          <p>
            {richText(t, "operations.search.keyboardHelp", {
              keys: (
                <>
                  <kbd>↑</kbd>
                  <kbd>↓</kbd>
                </>
              ),
            })}
          </p>
        </form>
      </header>

      {isPending ? (
        <p className={styles.searchProgress} role="status">
          {t("operations.search.searching")}
        </p>
      ) : null}
      {!query ? (
        <section
          className={styles.searchWelcome}
          aria-labelledby="search-scope-title"
        >
          <h2 id="search-scope-title">{t("operations.search.scope.title")}</h2>
          <p>{t("operations.search.scope.description")}</p>
          <ul>
            <li>{t("operations.search.scope.accounts")}</li>
            <li>{t("operations.search.scope.agreements")}</li>
            <li>{t("operations.search.scope.commercial")}</li>
            <li>{t("operations.queueWork")}</li>
          </ul>
        </section>
      ) : results.length === 0 ? (
        <EmptyState
          title={t("operations.search.noResults.title", { query })}
          description={t("operations.search.noResults.description")}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                if (inputRef.current) inputRef.current.value = "";
                commit("");
              }}
            >
              {t("operations.search.clear")}
            </Button>
          }
        />
      ) : (
        <section
          id="global-search-results"
          className={styles.searchResults}
          aria-label={t("operations.search.results")}
        >
          <div className={styles.searchResultCount} aria-live="polite">
            <strong>{t("common.results", { count: results.length })}</strong>
            <span>{t("operations.search.grouped")}</span>
          </div>
          {groups.map((entry) => (
            <section
              className={styles.searchGroup}
              key={entry.group}
              aria-labelledby={`search-group-${entry.group}`}
            >
              <h2 id={`search-group-${entry.group}`}>
                {t(searchGroupLabels[entry.group])}
                <span className={styles.groupCount} aria-hidden="true">
                  {entry.results.length}
                </span>
                <span className="sr-only">
                  {t("common.results", { count: entry.results.length })}
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
                          ref={(node) => {
                            linkRefs.current[index] = node;
                          }}
                          href={record.href as Route}
                          onFocus={() => setActiveIndex(index)}
                          onKeyDown={onKeyDown}
                        >
                          {record.title}
                        </Link>
                        <DetailLine record={record} />
                      </div>
                      <div className={styles.searchMeta}>
                        <span>{statusText(record, t)}</span>
                        <details>
                          <summary>{t("common.referenceLabel")}</summary>
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
