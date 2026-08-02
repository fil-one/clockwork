import type { Route } from "next";

import type { CommercialRecord } from "./model";

export const standardCollectionParams = [
  "q",
  "status",
  "risk",
  "owner",
  "sort",
  "view",
  "page",
  "pageSize",
] as const;

export type StandardCollectionParam = (typeof standardCollectionParams)[number];
export type RawSearchParams = Record<string, string | string[] | undefined>;

export interface CollectionState {
  q: string;
  status: string;
  risk: string;
  owner: string;
  sort: "updated_desc" | "updated_asc" | "title_asc" | "value_desc";
  view: "table" | "compact";
  page: number;
  pageSize: number;
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/** The single forward-link value a task surface was opened with, if any. */
export function firstSearchParam(
  input: RawSearchParams,
  key: string,
): string | undefined {
  return first(input[key]).trim() || undefined;
}

function positiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseCollectionState(input: RawSearchParams): CollectionState {
  const sort = first(input.sort);
  const view = first(input.view);
  const requestedSize = positiveInt(first(input.pageSize), 10);
  return {
    q: first(input.q).trim().slice(0, 120),
    status: first(input.status),
    risk: first(input.risk),
    owner: first(input.owner),
    sort: ["updated_asc", "title_asc", "value_desc"].includes(sort)
      ? (sort as CollectionState["sort"])
      : "updated_desc",
    view: view === "compact" ? "compact" : "table",
    page: positiveInt(first(input.page), 1),
    pageSize: [5, 10, 20].includes(requestedSize) ? requestedSize : 10,
  };
}

function numericValue(value: string): number {
  const number = Number(value.replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(number) ? number : 0;
}

export function filterAndSortRecords(
  records: readonly CommercialRecord[],
  state: CollectionState,
): CommercialRecord[] {
  const query = state.q.toLocaleLowerCase();
  return records
    .filter((record) => {
      const haystack = [
        record.title,
        record.description,
        record.id,
        record.statusLabel,
        record.owner,
      ]
        .join(" ")
        .toLocaleLowerCase();
      return (
        (!query || haystack.includes(query)) &&
        (!state.status || record.status === state.status) &&
        (!state.risk || record.risk === state.risk) &&
        (!state.owner || record.owner === state.owner)
      );
    })
    .sort((left, right) => {
      if (state.sort === "title_asc")
        return left.title.localeCompare(right.title);
      if (state.sort === "value_desc")
        return numericValue(right.value) - numericValue(left.value);
      const direction = state.sort === "updated_asc" ? 1 : -1;
      return left.updatedAt.localeCompare(right.updatedAt) * direction;
    });
}

export function collectionUrl(
  pathname: string,
  state: CollectionState,
  changes: Partial<Record<StandardCollectionParam, string | number>> = {},
): Route {
  const next = { ...state, ...changes };
  const params = new URLSearchParams();
  for (const key of standardCollectionParams) {
    const value = next[key];
    if (value !== "" && value !== undefined) params.set(key, String(value));
  }
  return `${pathname}?${params.toString()}` as Route;
}
