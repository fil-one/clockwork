import type { PartnerRecord } from "./partner-data";

export const partnerQueryKeys = [
  "q",
  "status",
  "risk",
  "owner",
  "sort",
  "view",
  "page",
  "pageSize",
] as const;

export type PartnerQueryKey = (typeof partnerQueryKeys)[number];
export type PartnerSort = "name-asc" | "name-desc" | "risk-desc" | "status-asc";
export type PartnerView =
  "table" | "cards" | "loading" | "empty" | "permission" | "error";

export interface PartnerQueryState {
  q: string;
  status: string;
  risk: string;
  owner: string;
  sort: PartnerSort;
  view: PartnerView;
  page: number;
  pageSize: number;
}

const sortValues: readonly PartnerSort[] = [
  "name-asc",
  "name-desc",
  "risk-desc",
  "status-asc",
];
const viewValues: readonly PartnerView[] = [
  "table",
  "cards",
  "loading",
  "empty",
  "permission",
  "error",
];

function positiveInteger(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parsePartnerQuery(params: URLSearchParams): PartnerQueryState {
  const sort = params.get("sort") as PartnerSort | null;
  const view = params.get("view") as PartnerView | null;
  const pageSize = positiveInteger(params.get("pageSize"), 10);
  return {
    q: params.get("q")?.trim() ?? "",
    status: params.get("status") ?? "all",
    risk: params.get("risk") ?? "all",
    owner: params.get("owner") ?? "all",
    sort: sort && sortValues.includes(sort) ? sort : "name-asc",
    view: view && viewValues.includes(view) ? view : "table",
    page: positiveInteger(params.get("page"), 1),
    pageSize: [5, 10, 20].includes(pageSize) ? pageSize : 10,
  };
}

export function updatePartnerQuery(
  current: URLSearchParams,
  updates: Partial<Record<PartnerQueryKey, string | number>>,
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const [key, raw] of Object.entries(updates)) {
    const value = String(raw);
    if (!value || (key === "page" && value === "1")) next.delete(key);
    else next.set(key, value);
  }
  if (Object.keys(updates).some((key) => !["page", "pageSize"].includes(key)))
    next.delete("page");
  return next;
}

const riskRank = { low: 1, medium: 2, high: 3 } as const;

export function sortPartnerRecords(
  records: readonly PartnerRecord[],
  sort: PartnerSort,
): PartnerRecord[] {
  return [...records].sort((left, right) => {
    if (sort === "name-desc") return right.name.localeCompare(left.name);
    if (sort === "risk-desc")
      return (
        riskRank[right.risk] - riskRank[left.risk] ||
        left.name.localeCompare(right.name)
      );
    if (sort === "status-asc")
      return (
        left.status.localeCompare(right.status) ||
        left.name.localeCompare(right.name)
      );
    return left.name.localeCompare(right.name);
  });
}

export function filterPartnerRecords(
  records: readonly PartnerRecord[],
  state: PartnerQueryState,
): PartnerRecord[] {
  const q = state.q.toLocaleLowerCase();
  return sortPartnerRecords(
    records.filter((record) => {
      const matchesText =
        !q ||
        [record.name, record.context, record.id, record.value, record.secondary]
          .join(" ")
          .toLocaleLowerCase()
          .includes(q);
      return (
        matchesText &&
        (state.status === "all" || record.status === state.status) &&
        (state.risk === "all" || record.risk === state.risk) &&
        (state.owner === "all" || record.owner === state.owner)
      );
    }),
    state.sort,
  );
}

export function paginatePartnerRecords(
  records: readonly PartnerRecord[],
  page: number,
  pageSize: number,
) {
  const pageCount = Math.max(1, Math.ceil(records.length / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  return {
    page: safePage,
    pageCount,
    records: records.slice((safePage - 1) * pageSize, safePage * pageSize),
  };
}
