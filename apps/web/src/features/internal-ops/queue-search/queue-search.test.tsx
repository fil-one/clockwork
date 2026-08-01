import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILTERS,
  filterQueueItems,
  matchesSavedView,
  parseQueueFilters,
  permittedActions,
  QUEUE_ITEMS,
  SAVED_VIEWS,
  selectQueueItem,
  serializeQueueFilters,
  sortQueueItems,
} from "./model";
import { QueueDetail } from "./queue-detail";
import {
  groupSearchResults,
  nextSearchIndex,
  searchRecords,
} from "./search-model";

describe("operational queue saved views", () => {
  it("defines and applies all five human-readable saved views", () => {
    expect(SAVED_VIEWS.map((view) => view.label)).toEqual([
      "Assigned to me",
      "SLA breached",
      "High risk",
      "Awaiting backup",
      "All",
    ]);
    expect(
      QUEUE_ITEMS.filter((item) => matchesSavedView(item, "assigned-to-me")),
    ).toSatisfy((items: typeof QUEUE_ITEMS) =>
      items.every(
        (item) => item.owner === "James Kurz" && item.status !== "resolved",
      ),
    );
    expect(
      QUEUE_ITEMS.filter((item) => matchesSavedView(item, "awaiting-backup")),
    ).toSatisfy(
      (items: typeof QUEUE_ITEMS) =>
        items.length > 0 && items.every((item) => item.backup === null),
    );
  });
});

describe("queue URL state", () => {
  it("round trips every supported filter using only the required URL keys", () => {
    const params = serializeQueueFilters({
      ...DEFAULT_FILTERS,
      text: "Northstar",
      type: "collections",
      backup: "unassigned",
      sla: "breached",
      age: "8-30",
      status: "blocked",
      risk: "high",
      owner: "usr_amina_cole",
      view: "sla-breached",
      page: 2,
      pageSize: 25,
    });
    expect([...params.keys()]).toEqual([
      "q",
      "status",
      "risk",
      "owner",
      "sort",
      "view",
      "page",
      "pageSize",
    ]);
    expect(params.get("q")).toBe(
      "Northstar type:collections backup:unassigned sla:breached age:8-30",
    );
    expect(parseQueueFilters(params)).toMatchObject({
      text: "Northstar",
      type: "collections",
      backup: "unassigned",
      sla: "breached",
      age: "8-30",
      status: "blocked",
      risk: "high",
      owner: "usr_amina_cole",
      view: "sla-breached",
      page: 2,
      pageSize: 25,
    });
  });

  it("normalizes unsafe pagination and unknown saved views", () => {
    expect(
      parseQueueFilters(
        new URLSearchParams("view=unknown&page=-4&pageSize=900"),
      ),
    ).toMatchObject({
      view: "all",
      page: 1,
      pageSize: 10,
    });
  });
});

describe("queue filtering and priority", () => {
  it("sorts SLA breaches first, then highest risk, then oldest", () => {
    const sorted = sortQueueItems(QUEUE_ITEMS);
    expect(sorted.slice(0, 2).map((item) => item.id)).toEqual([
      "EXC-COL-008",
      "EXC-SCR-004",
    ]);
    expect(sorted.findIndex((item) => item.id === "EXC-PRC-019")).toBeLessThan(
      sorted.findIndex((item) => item.id === "EXC-POC-021"),
    );
  });

  it("combines type, SLA, risk, owner, backup, status, and age filters", () => {
    const results = filterQueueItems(QUEUE_ITEMS, {
      ...DEFAULT_FILTERS,
      type: "collections",
      sla: "breached",
      risk: "high",
      owner: "usr_amina_cole",
      backup: "usr_james_kurz",
      status: "blocked",
      age: "8-30",
    });
    expect(results.map((item) => item.id)).toEqual(["EXC-COL-008"]);
  });
});

describe("queue permission and evidence disclosure", () => {
  it("removes role-gated decision actions without hiding safe evidence work", () => {
    const collections = QUEUE_ITEMS.find((item) => item.id === "EXC-COL-008");
    if (!collections) throw new Error("Expected the collections fixture.");
    expect(permittedActions(collections, ["internal_operator"])).toEqual([
      "Add evidence",
      "Reassign owner",
    ]);
    expect(permittedActions(collections, ["finance_approver"])).toEqual(
      collections.permittedActions,
    );
  });

  it("keeps technical IDs in an explicit evidence disclosure", async () => {
    const user = userEvent.setup();
    const item = QUEUE_ITEMS.find(
      (candidate) => candidate.id === "EXC-SCR-004",
    );
    if (!item) throw new Error("Expected the screening fixture.");
    render(<QueueDetail item={item} />);
    expect(screen.getByRole("heading", { name: "Evidence" })).toBeVisible();
    const disclosure = screen.getByText("Technical identifier");
    expect(disclosure.closest("details")).not.toHaveAttribute("open");
    await user.click(disclosure);
    expect(screen.getByText("scr_01J4Q9NZX8M3")).toBeVisible();
    expect(
      screen.getByText(/does not have the required legal approver role/i),
    ).toBeVisible();
  });
});

describe("split-view selection", () => {
  it("keeps the requested item selected and safely falls back after filtering", () => {
    expect(selectQueueItem(QUEUE_ITEMS, "EXC-PRC-019")?.title).toBe(
      "Pricing exception for Halcyon expansion",
    );
    expect(selectQueueItem(QUEUE_ITEMS.slice(0, 2), "EXC-PRC-019")?.id).toBe(
      "EXC-COL-008",
    );
    expect(selectQueueItem([], "EXC-PRC-019")).toBeNull();
  });
});

describe("grouped global search", () => {
  it("searches IDs and human-readable fields, then groups by record type", () => {
    const grouped = groupSearchResults(searchRecords("Northstar"));
    expect(grouped.map((entry) => entry.group)).toEqual([
      "Accounts",
      "Agreements",
      "Quotes",
      "Orders",
      "Invoices",
      "Queues",
    ]);
    expect(searchRecords("EXC-SCR-004")[0]?.title).toBe(
      "Restricted-party possible match",
    );
  });

  it("wraps keyboard navigation in both directions", () => {
    expect(nextSearchIndex(-1, "ArrowDown", 3)).toBe(0);
    expect(nextSearchIndex(2, "ArrowDown", 3)).toBe(0);
    expect(nextSearchIndex(0, "ArrowUp", 3)).toBe(2);
  });
});
