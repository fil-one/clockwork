export const collectionStatuses = [
  "all",
  "active",
  "pending",
  "review",
  "complete",
  "blocked",
] as const;

export const collectionRisks = ["all", "low", "medium", "high"] as const;
/**
 * `value-asc` is the addition, and it is what makes the value column's header
 * a control rather than a one-way door: without it a reader who sorted by
 * value could not return to any other ordering from the header row.
 */
export const collectionSorts = [
  "updated-desc",
  "updated-asc",
  "title-asc",
  "title-desc",
  "value-desc",
  "value-asc",
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

/**
 * One row as the page shows it and as the filters, search and sort read it:
 * every field is text in the reader's language. `presentCustomerRecord` turns
 * a `CustomerCollectionRecord` into this.
 */
export interface CustomerCollectionRow {
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
  recordVersion?: number;
  projectionId?: string;
  aggregateId?: string;
}

/**
 * The finer state a record's chip names. The coarse `status` above is what the
 * status filter selects on; this is what the chip says.
 */
export const collectionStatusDetails = [
  "inReview",
  "awaitingCustomer",
  "effective",
  "completed",
  "closedNotAccepted",
  "active",
  "invitationPending",
  "accessRemoved",
  "verified",
  "awaitingBankCheck",
  "current",
  "accepted",
  "buyerAcceptanceNeeded",
  "disbursementPending",
  "expired",
  "inProgress",
  "resolved",
] as const;
export type CollectionStatusDetail = (typeof collectionStatusDetails)[number];

/** What the "updated" column says happened, on the record's `updatedAt`. */
export const collectionUpdateKinds = [
  "updated",
  "lastActive",
  "invited",
  "removed",
  "verified",
  "accepted",
  "expired",
  "providerSync",
  "providerUpdate",
  "resolved",
] as const;
export type CollectionUpdateKind = (typeof collectionUpdateKinds)[number];

export const collectionMemberRoles = [
  "owner",
  "admin",
  "billing",
  "member",
  "formerMember",
] as const;
export type CollectionMemberRole = (typeof collectionMemberRoles)[number];

export const collectionCurrencies = ["USD", "EUR", "GBP"] as const;
export type CollectionCurrency = (typeof collectionCurrencies)[number];

/**
 * A record's value column as facts. Amounts are integer minor units in the
 * record's currency and dates are calendar dates (YYYY-MM-DD); the page formats
 * both for the reader and places them in a message. An address or reference
 * needs no fact: it is a plain string, shown as written.
 */
export type CollectionValueFact =
  | {
      readonly kind: "perYear" | "increasePerYear" | "estimated";
      readonly currency: CollectionCurrency;
      readonly amountMinor: string;
    }
  | { readonly kind: "noSpendChange" | "noCommitment" | "resolved" }
  | { readonly kind: "role"; readonly role: CollectionMemberRole }
  | { readonly kind: "dueOn" | "expiresOn"; readonly on: string }
  | { readonly kind: "taxFormYear"; readonly year: number }
  | { readonly kind: "priority"; readonly priority: "normal" | "high" };

/** The labels a record's context entries carry, as a closed set. */
export const collectionContextFields = [
  "service",
  "services",
  "effective",
  "needed",
  "agreement",
  "evidence",
  "reason",
  "serviceStart",
  "access",
  "security",
  "approvalLimit",
  "expires",
  "invoiceDelivery",
  "creditDelivery",
  "system",
  "nextStep",
  "jurisdiction",
  "document",
  "order",
  "entity",
  "classification",
  "marketplace",
  "billing",
  "commitment",
  "source",
  "invoice",
] as const;
export type CollectionContextField = (typeof collectionContextFields)[number];

/** States the product itself writes into a context entry. */
export const collectionContextStates = [
  "allWorkflows",
  "viewCommercialRecords",
  "noCurrentAccess",
  "mfaVerified",
  "mfaNotEnrolled",
  "removalRecorded",
  "emailAndPortal",
  "email",
  "supportProvider",
  "none",
] as const;
export type CollectionContextState = (typeof collectionContextStates)[number];

/**
 * A context entry's value as facts. `text` is demo-authored or typed text,
 * already in the reader's language when it reaches the page; `literal` is a
 * name, reference or code that is never translated.
 */
export type CollectionContextValue =
  | { readonly kind: "text" | "literal"; readonly text: string }
  | { readonly kind: "date"; readonly on: string }
  | {
      readonly kind: "money";
      readonly currency: CollectionCurrency;
      readonly amountMinor: string;
    }
  | { readonly kind: "activeServices"; readonly count: number }
  | { readonly kind: "state"; readonly state: CollectionContextState }
  | { readonly kind: "merchantOfRecord"; readonly provider: string };

/**
 * A record as the loader delivers it. Each presentational field is either the
 * text a production projection wrote, shown as written, or facts the page
 * renders in the reader's language: the demo fixtures carry facts, so a
 * Portuguese reader of the demo sees Portuguese labels and Portuguese dates.
 */
export interface CustomerCollectionRecord extends Omit<
  CustomerCollectionRow,
  "statusLabel" | "value" | "updatedLabel" | "context"
> {
  statusLabel: string | { readonly detail: CollectionStatusDetail };
  value: string | CollectionValueFact;
  updatedLabel: string | { readonly update: CollectionUpdateKind };
  context: readonly (
    | { label: string; value: string }
    | {
        readonly field: CollectionContextField;
        readonly value: CollectionContextValue;
      }
  )[];
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
  records: readonly CustomerCollectionRow[],
  state: CollectionUrlState,
): CustomerCollectionRow[] {
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
    if (state.sort === "value-asc") return left.valueSort - right.valueSort;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

export function paginateRecords(
  records: readonly CustomerCollectionRow[],
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
