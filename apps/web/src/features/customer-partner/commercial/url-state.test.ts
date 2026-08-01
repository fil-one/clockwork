import { describe, expect, it } from "vitest";

import { recordsFor } from "./model";
import {
  collectionUrl,
  filterAndSortRecords,
  parseCollectionState,
  standardCollectionParams,
} from "./url-state";

describe("commercial collection URL state", () => {
  it("parses and constrains every standard URL parameter", () => {
    expect(standardCollectionParams).toEqual([
      "q",
      "status",
      "risk",
      "owner",
      "sort",
      "view",
      "page",
      "pageSize",
    ]);
    expect(
      parseCollectionState({
        q: "archive",
        status: "open",
        risk: "medium",
        owner: "Maya Chen",
        sort: "value_desc",
        view: "compact",
        page: "2",
        pageSize: "20",
      }),
    ).toEqual({
      q: "archive",
      status: "open",
      risk: "medium",
      owner: "Maya Chen",
      sort: "value_desc",
      view: "compact",
      page: 2,
      pageSize: 20,
    });
  });

  it("filters across human context and applies deterministic sorting", () => {
    const records = recordsFor("quotes");
    const filtered = filterAndSortRecords(
      records,
      parseCollectionState({
        q: "enterprise",
        status: "open",
        risk: "medium",
        owner: "Maya Chen",
        sort: "title_asc",
      }),
    );
    expect(filtered.map((record) => record.id)).toEqual(["Q-2026-0184-v3"]);

    const byValue = filterAndSortRecords(
      records,
      parseCollectionState({ sort: "value_desc" }),
    );
    expect(byValue.at(0)?.value).toBe("$184,800.00");
  });

  it("preserves active filters while paging", () => {
    const state = parseCollectionState({
      q: "archive",
      status: "open",
      risk: "medium",
      owner: "Maya Chen",
      sort: "updated_asc",
      view: "compact",
      page: "1",
      pageSize: "5",
    });
    const url = new URL(
      collectionUrl("/quotes", state, { page: 2 }),
      "https://clockwork.example",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "archive",
      status: "open",
      risk: "medium",
      owner: "Maya Chen",
      sort: "updated_asc",
      view: "compact",
      page: "2",
      pageSize: "5",
    });
  });
});
