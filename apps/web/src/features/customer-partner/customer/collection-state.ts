export const collectionStatuses = [
  "all",
  "active",
  "pending",
  "review",
  "complete",
  "blocked",
] as const;

export const collectionRisks = ["all", "low", "medium", "high"] as const;
export const collectionSorts = [
  "updated-desc",
  "updated-asc",
  "title-asc",
  "title-desc",
  "value-desc",
] as const;
export const collectionViews = ["table", "cards"] as const;
export const collectionPageSizes = [5, 10, 25] as const;

export type CollectionStatus = (typeof collectionStatuses)[number];
export type CollectionRisk = (typeof collectionRisks)[number];
export type CollectionSort = (typeof collectionSorts)[number];
export type CollectionView = (typeof collectionViews)[number];

export type RawCollectionSearchParams = Record<
  string,
  string | string[] | undefined
>;

export interface CollectionUrlState {
  q: string;
  status: CollectionStatus;
  risk: CollectionRisk;
  owner: string;
  sort: CollectionSort;
  view: CollectionView;
  page: number;
  pageSize: (typeof collectionPageSizes)[number];
}

export interface CustomerCollectionRecord {
  id: string;
  title: string;
  description: string;
  status: Exclude<CollectionStatus, "all">;
  statusLabel: string;
  risk: Exclude<CollectionRisk, "all">;
  owner: string;
  value: string;
  valueSort: number;
  updatedAt: string;
  updatedLabel: string;
  href?: string;
  context: readonly { label: string; value: string }[];
}

const defaultState: CollectionUrlState = {
  q: "",
  status: "all",
  risk: "all",
  owner: "all",
  sort: "updated-desc",
  view: "table",
  page: 1,
  pageSize: 10,
};

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isIncluded<T extends string>(
  options: readonly T[],
  value: string | undefined,
): value is T {
  return Boolean(value && (options as readonly string[]).includes(value));
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseCollectionState(
  params: RawCollectionSearchParams,
): CollectionUrlState {
  const status = single(params.status);
  const risk = single(params.risk);
  const sort = single(params.sort);
  const view = single(params.view);
  const requestedPageSize = positiveInteger(
    single(params.pageSize),
    defaultState.pageSize,
  );

  return {
    q: (single(params.q) ?? defaultState.q).trim().slice(0, 120),
    status: isIncluded(collectionStatuses, status)
      ? status
      : defaultState.status,
    risk: isIncluded(collectionRisks, risk) ? risk : defaultState.risk,
    owner: (single(params.owner) ?? defaultState.owner).trim() || "all",
    sort: isIncluded(collectionSorts, sort) ? sort : defaultState.sort,
    view: isIncluded(collectionViews, view) ? view : defaultState.view,
    page: positiveInteger(single(params.page), defaultState.page),
    pageSize: collectionPageSizes.includes(
      requestedPageSize as (typeof collectionPageSizes)[number],
    )
      ? (requestedPageSize as (typeof collectionPageSizes)[number])
      : defaultState.pageSize,
  };
}

export function serializeCollectionState(
  state: CollectionUrlState,
  overrides: Partial<Record<keyof CollectionUrlState, string | number>> = {},
): URLSearchParams {
  const merged = { ...state, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set("q", String(merged.q));
  if (merged.status !== "all") params.set("status", String(merged.status));
  if (merged.risk !== "all") params.set("risk", String(merged.risk));
  if (merged.owner !== "all") params.set("owner", String(merged.owner));
  if (merged.sort !== defaultState.sort)
    params.set("sort", String(merged.sort));
  if (merged.view !== defaultState.view)
    params.set("view", String(merged.view));
  if (Number(merged.page) > 1) params.set("page", String(merged.page));
  if (Number(merged.pageSize) !== defaultState.pageSize)
    params.set("pageSize", String(merged.pageSize));
  return params;
}

export function filterAndSortRecords(
  records: readonly CustomerCollectionRecord[],
  state: CollectionUrlState,
): CustomerCollectionRecord[] {
  const query = state.q.toLocaleLowerCase();
  const filtered = records.filter((record) => {
    const searchable = [
      record.id,
      record.title,
      record.description,
      record.owner,
      record.statusLabel,
      record.value,
      ...record.context.flatMap((item) => [item.label, item.value]),
    ]
      .join(" ")
      .toLocaleLowerCase();
    return (
      (!query || searchable.includes(query)) &&
      (state.status === "all" || record.status === state.status) &&
      (state.risk === "all" || record.risk === state.risk) &&
      (state.owner === "all" || record.owner === state.owner)
    );
  });

  return filtered.toSorted((left, right) => {
    if (state.sort === "updated-asc")
      return left.updatedAt.localeCompare(right.updatedAt);
    if (state.sort === "title-asc")
      return left.title.localeCompare(right.title);
    if (state.sort === "title-desc")
      return right.title.localeCompare(left.title);
    if (state.sort === "value-desc") return right.valueSort - left.valueSort;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

export function paginateRecords(
  records: readonly CustomerCollectionRecord[],
  state: CollectionUrlState,
) {
  const pageCount = Math.max(1, Math.ceil(records.length / state.pageSize));
  const page = Math.min(state.page, pageCount);
  const start = (page - 1) * state.pageSize;
  return {
    page,
    pageCount,
    records: records.slice(start, start + state.pageSize),
    firstResult: records.length === 0 ? 0 : start + 1,
    lastResult: Math.min(start + state.pageSize, records.length),
  };
}
