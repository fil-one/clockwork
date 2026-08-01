import { describe, expect, it } from "vitest";

import {
  filterAndSortRecords,
  paginateRecords,
  parseCollectionState,
  serializeCollectionState,
  type CustomerCollectionRecord,
} from "./collection-state";

const records: readonly CustomerCollectionRecord[] = [
  {
    id: "REC-2",
    title: "Zulu renewal",
    description: "Second",
    status: "pending",
    statusLabel: "Pending",
    risk: "high",
    owner: "Maya Chen",
    value: "$200",
    valueSort: 200,
    updatedAt: "2026-07-31T12:00:00Z",
    updatedLabel: "Today",
    context: [],
  },
  {
    id: "REC-1",
    title: "Alpha service",
    description: "First",
    status: "active",
    statusLabel: "Active",
    risk: "low",
    owner: "Elias Romero",
    value: "$100",
    valueSort: 100,
    updatedAt: "2026-07-30T12:00:00Z",
    updatedLabel: "Yesterday",
    context: [],
  },
];

describe("customer collection URL state", () => {
  it("parses supported standard parameters and rejects invalid values", () => {
    expect(
      parseCollectionState({
        q: "  renewal ",
        status: "pending",
        risk: "high",
        owner: "Maya Chen",
        sort: "title-asc",
        view: "cards",
        page: "2",
        pageSize: "5",
      }),
    ).toEqual({
      q: "renewal",
      status: "pending",
      risk: "high",
      owner: "Maya Chen",
      sort: "title-asc",
      view: "cards",
      page: 2,
      pageSize: 5,
    });
    expect(
      parseCollectionState({ sort: "unknown", page: "-3", pageSize: "999" }),
    ).toMatchObject({ sort: "updated-desc", page: 1, pageSize: 10 });
  });

  it("serializes only meaningful state while preserving every active filter", () => {
    const state = parseCollectionState({
      q: "service",
      status: "active",
      risk: "low",
      owner: "Elias Romero",
      sort: "value-desc",
      view: "cards",
      page: "3",
      pageSize: "5",
    });
    expect(serializeCollectionState(state).toString()).toBe(
      "q=service&status=active&risk=low&owner=Elias+Romero&sort=value-desc&view=cards&page=3&pageSize=5",
    );
  });
});

describe("customer collection results", () => {
  it("searches, filters, and applies stable task-specific sorting", () => {
    const filtered = filterAndSortRecords(
      records,
      parseCollectionState({ risk: "high", sort: "title-asc" }),
    );
    expect(filtered.map((record) => record.id)).toEqual(["REC-2"]);
    expect(
      filterAndSortRecords(
        records,
        parseCollectionState({ sort: "value-desc" }),
      ).map((record) => record.id),
    ).toEqual(["REC-2", "REC-1"]);
  });

  it("clamps pagination to the available result range", () => {
    const page = paginateRecords(
      records,
      parseCollectionState({ page: "9", pageSize: "5" }),
    );
    expect(page).toMatchObject({
      page: 1,
      pageCount: 1,
      firstResult: 1,
      lastResult: 2,
    });
  });
});
