import { describe, expect, it } from "vitest";

import { partnerSurfaces } from "./partner-data";
import {
  filterPartnerRecords,
  paginatePartnerRecords,
  parsePartnerQuery,
  sortPartnerRecords,
  updatePartnerQuery,
} from "./partner-query";

describe("partner collection URL state", () => {
  it("parses and preserves the standard query contract", () => {
    const params = new URLSearchParams(
      "q=halcyon&status=attention&risk=medium&owner=Juno+Okafor&sort=risk-desc&view=cards&page=2&pageSize=5",
    );
    expect(parsePartnerQuery(params)).toEqual({
      q: "halcyon",
      status: "attention",
      risk: "medium",
      owner: "Juno Okafor",
      sort: "risk-desc",
      view: "cards",
      page: 2,
      pageSize: 5,
    });
  });

  it("resets pagination when a decision filter changes", () => {
    const next = updatePartnerQuery(
      new URLSearchParams("q=old&page=3&pageSize=5&sort=name-asc"),
      { q: "atlas", risk: "high" },
    );
    expect(next.get("q")).toBe("atlas");
    expect(next.get("risk")).toBe("high");
    expect(next.has("page")).toBe(false);
    expect(next.get("pageSize")).toBe("5");
  });

  it("refuses synthetic view states so a partner cannot fake one", () => {
    for (const view of ["loading", "empty", "permission", "error"])
      expect(parsePartnerQuery(new URLSearchParams(`view=${view}`)).view).toBe(
        "table",
      );
  });

  it("falls back safely for invalid URL values", () => {
    expect(
      parsePartnerQuery(
        new URLSearchParams("sort=unknown&view=grid&page=-3&pageSize=500"),
      ),
    ).toMatchObject({
      sort: "name-asc",
      view: "table",
      page: 1,
      pageSize: 10,
    });
  });
});

describe("partner collection sorting and paging", () => {
  const records = partnerSurfaces.portfolio.records;

  it("sorts highest risk first without mutating source data", () => {
    const original = records.map((record) => record.name);
    const sorted = sortPartnerRecords(records, "risk-desc");
    expect(sorted.map((record) => record.risk)).toEqual([
      "high",
      "medium",
      "low",
    ]);
    expect(records.map((record) => record.name)).toEqual(original);
  });

  it("filters across names and commercial context", () => {
    const state = parsePartnerQuery(
      new URLSearchParams("q=two-tier&risk=high"),
    );
    expect(
      filterPartnerRecords(records, state).map((record) => record.name),
    ).toEqual(["Atlas Field Imaging"]);
  });

  it("clamps stale pages after result counts change", () => {
    expect(paginatePartnerRecords(records, 99, 2)).toMatchObject({
      page: 2,
      pageCount: 2,
    });
  });
});
