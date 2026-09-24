import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type {
  ProjectionChannel,
  ProjectionRecord,
} from "@/src/features/experience-server/model";

import {
  activeFilterLabels,
  DEFAULT_FILTERS,
  filterQueueItems,
  matchesSavedView,
  paginateQueueItems,
  parseQueueFilters,
  permittedActions,
  queueOwnerOptions,
  queueTypeOptions,
  SAVED_VIEWS,
  selectQueueItem,
  serializeQueueFilters,
  slaFor,
  sortQueueItems,
  type QueueItem,
} from "./model";
import { QueueDetail } from "./queue-detail";
import { queueItemFromProjection } from "./queue-projection";
import {
  groupSearchResults,
  nextSearchIndex,
  searchRecordFromProjection,
  searchRecords,
  type SearchGroup,
} from "./search-model";

const NOW = new Date("2026-07-31T16:00:00Z");

let sequence = 0;

function identifier(): string {
  sequence += 1;
  return `40000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function projection(
  channel: ProjectionChannel,
  recordKey: string,
  data: Readonly<Record<string, unknown>> = {},
  accountId: string | null = null,
): ProjectionRecord {
  const aggregateId = identifier();
  return {
    id: aggregateId,
    recordKey,
    aggregateType: channel === "queues" ? "exception_case" : channel,
    aggregateId,
    accountId,
    audience: "internal",
    channel,
    version: 3,
    sourceUpdatedAt: "2026-07-31T15:42:00.000Z",
    projectedAt: "2026-07-31T16:00:00.000Z",
    stale: false,
    data,
  };
}

/**
 * An exception case in the shape `describeAggregate` writes it: a queue name, a
 * subject type and a target date under `authoritative`, with the presentation
 * fields derived from them.
 */
function exceptionCase(input: {
  key: string;
  queue: string;
  subject?: string;
  targetAt?: string | null;
  status?: string;
  risk?: string;
  updatedAt?: string;
}): QueueItem {
  const reference = `EXC-${input.key.toUpperCase()}`;
  const record = projection("queues", input.key, {
    kind: "queues",
    reference,
    title: `${reference} · ${input.queue}`,
    owner: reference,
    description: `${input.queue} case awaiting a decision`,
    status: input.status ?? "open",
    risk: input.risk ?? "medium",
    context: [
      { label: "Queue", value: input.queue },
      ...(input.subject ? [{ label: "Subject", value: input.subject }] : []),
    ],
    allowedActions: [],
    authoritative: {
      queue: input.queue,
      ...(input.subject ? { objectType: input.subject } : {}),
      ...(input.targetAt ? { targetAt: input.targetAt } : {}),
      status: input.status ?? "open",
    },
  });
  return queueItemFromProjection(
    input.updatedAt ? { ...record, sourceUpdatedAt: input.updatedAt } : record,
  );
}

/** The four cases the filter, sort and saved-view assertions share. */
function operationalQueue(): readonly QueueItem[] {
  return [
    exceptionCase({
      key: "col-008",
      queue: "collections",
      subject: "invoice",
      targetAt: "2026-07-30T17:00:00.000Z",
      status: "blocked",
      risk: "high",
      updatedAt: "2026-07-31T15:42:00.000Z",
    }),
    exceptionCase({
      key: "scr-004",
      queue: "screening",
      subject: "order",
      targetAt: "2026-07-31T20:00:00.000Z",
      status: "open",
      risk: "high",
      updatedAt: "2026-07-31T15:18:00.000Z",
    }),
    exceptionCase({
      key: "prc-019",
      queue: "pricing",
      subject: "quote",
      targetAt: "2026-08-05T17:00:00.000Z",
      status: "pending",
      risk: "medium",
      updatedAt: "2026-07-31T15:59:00.000Z",
    }),
    exceptionCase({
      key: "poc-021",
      queue: "qualification",
      targetAt: null,
      status: "complete",
      risk: "low",
      updatedAt: "2026-07-30T09:00:00.000Z",
    }),
  ];
}

/**
 * Assignment does not exist in any projection payload yet. The fields that
 * depend on it are set here, and only here, so the model keeps working the day
 * the source publishes them.
 */
function assigned(item: QueueItem, overrides: Partial<QueueItem>): QueueItem {
  return { ...item, ...overrides };
}

describe("queue records built from operational projections", () => {
  it("keeps every field the projection does not supply empty", () => {
    const record = projection("queues", "EXC-COL-008", {
      title: "Collections aging decision",
      statusLabel: "SLA breached · high risk",
      owner: "Amina Cole",
      nextAction: "Verify retention hold before service action",
      allowedActions: ["review_exception"],
    });
    const item = queueItemFromProjection(record);
    expect(item).toMatchObject({
      id: "EXC-COL-008",
      title: "Collections aging decision",
      owner: "Amina Cole",
      statusLabel: "SLA breached · high risk",
      summary: "Verify retention hold before service action",
      permittedActions: ["Review Exception"],
      ownerId: null,
      backup: null,
      backupId: null,
      type: null,
      entity: null,
      risk: null,
      status: null,
      createdAt: null,
      dueAt: null,
      ageDays: null,
      policyReason: null,
      policyBasis: null,
      related: [],
    });
    expect(item.evidence).toEqual([
      {
        label: "Source record",
        value: "Version 3 · updated 2026-07-31T15:42:00.000Z",
        technicalId: record.aggregateId,
      },
    ]);
  });

  it("reads the queue, subject and deadline the canonical payload carries", () => {
    const [collections] = operationalQueue();
    expect(collections).toMatchObject({
      id: "col-008",
      type: "Collections",
      entity: "Invoice",
      risk: "high",
      status: "blocked",
      dueAt: "2026-07-30T17:00:00.000Z",
      updatedAt: "2026-07-31T15:42:00.000Z",
    });
    expect(collections?.evidence.slice(0, 2)).toEqual([
      { label: "Queue", value: "collections" },
      { label: "Subject", value: "invoice" },
    ]);
  });

  it("drops an owner that only repeats the record reference", () => {
    expect(operationalQueue()[0]?.owner).toBeNull();
  });

  it("maps a closed lifecycle status onto a resolved queue state", () => {
    expect(operationalQueue().map((item) => item.status)).toEqual([
      "blocked",
      "open",
      "pending",
      "resolved",
    ]);
  });

  it("never reports an SLA or an age it cannot measure", () => {
    const item = queueItemFromProjection(projection("queues", "EXC-1"));
    expect(slaFor(item, NOW)).toBeNull();
    expect(
      filterQueueItems([item], { ...DEFAULT_FILTERS, sla: "breached" }),
    ).toEqual([]);
    expect(
      filterQueueItems([item], { ...DEFAULT_FILTERS, age: "30+" }),
    ).toEqual([]);
    expect(filterQueueItems([item], DEFAULT_FILTERS)).toEqual([item]);
  });
});

describe("operational queue saved views", () => {
  it("defines all five human-readable saved views", () => {
    expect(SAVED_VIEWS.map((view) => view.label)).toEqual([
      "Assigned to me",
      "SLA breached",
      "High risk",
      "Awaiting backup",
      "All",
    ]);
  });

  it("selects breached, high-risk and backup-less work from real deadlines", () => {
    const items = operationalQueue();
    const applied = (view: Parameters<typeof matchesSavedView>[1]) =>
      items
        .filter((item) => matchesSavedView(item, view, { now: NOW }))
        .map((item) => item.id);
    expect(applied("sla-breached")).toEqual(["col-008"]);
    expect(applied("high-risk")).toEqual(["col-008", "scr-004"]);
    expect(applied("awaiting-backup")).toEqual([
      "col-008",
      "scr-004",
      "prc-019",
    ]);
    expect(applied("all")).toHaveLength(4);
  });

  it("matches assigned work only once a record names an assignee", () => {
    const [collections] = operationalQueue();
    if (!collections) throw new Error("Expected a collections case.");
    const actorId = "20000000-0000-4000-8000-000000000001";
    expect(matchesSavedView(collections, "assigned-to-me", { actorId })).toBe(
      false,
    );
    const mine = assigned(collections, { ownerId: actorId, owner: "Amina" });
    expect(matchesSavedView(mine, "assigned-to-me", { actorId })).toBe(true);
    expect(matchesSavedView(mine, "assigned-to-me")).toBe(false);
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

  it("names the active filters using the owners the records supplied", () => {
    expect(
      activeFilterLabels(
        { ...DEFAULT_FILTERS, owner: "usr_amina_cole", risk: "high" },
        [{ id: "usr_amina_cole", label: "Amina Cole" }],
      ),
    ).toEqual(["Owner: Amina Cole", "Risk: high"]);
    expect(
      activeFilterLabels({ ...DEFAULT_FILTERS, owner: "usr_amina_cole" }),
    ).toEqual(["Owner: usr_amina_cole"]);
  });
});

describe("queue filtering, priority and paging", () => {
  it("sorts SLA breaches first, then highest risk", () => {
    expect(
      sortQueueItems(operationalQueue(), undefined, NOW).map((item) => item.id),
    ).toEqual(["col-008", "scr-004", "prc-019", "poc-021"]);
  });

  it("sorts by most recently updated when asked", () => {
    expect(
      sortQueueItems(operationalQueue(), "updated", NOW).map((item) => item.id),
    ).toEqual(["prc-019", "col-008", "scr-004", "poc-021"]);
  });

  it("combines text, type, SLA, risk and status filters", () => {
    const items = operationalQueue();
    expect(
      filterQueueItems(
        items,
        {
          ...DEFAULT_FILTERS,
          type: "collections",
          sla: "breached",
          risk: "high",
          status: "blocked",
        },
        { now: NOW },
      ).map((item) => item.id),
    ).toEqual(["col-008"]);
    expect(
      filterQueueItems(items, { ...DEFAULT_FILTERS, text: "screening" }).map(
        (item) => item.id,
      ),
    ).toEqual(["scr-004"]);
    expect(
      filterQueueItems(items, { ...DEFAULT_FILTERS, owner: "usr_anyone" }),
    ).toEqual([]);
  });

  it("pages the sorted set and clamps a page past the last result", () => {
    const items = Array.from({ length: 12 }, (_, index) =>
      exceptionCase({ key: `case-${index}`, queue: "pricing" }),
    );
    expect(paginateQueueItems(items, 1, 10)).toMatchObject({
      page: 1,
      pageCount: 2,
    });
    expect(paginateQueueItems(items, 1, 10).items).toHaveLength(10);
    expect(
      paginateQueueItems(items, 2, 10).items.map((item) => item.id),
    ).toEqual(["case-10", "case-11"]);
    expect(paginateQueueItems(items, 9, 10)).toMatchObject({
      page: 2,
      pageCount: 2,
    });
    expect(paginateQueueItems([], 3, 10)).toMatchObject({
      page: 1,
      pageCount: 1,
      items: [],
    });
  });

  it("offers only the owners and types the loaded records contain", () => {
    const items = operationalQueue();
    expect(queueOwnerOptions(items)).toEqual([]);
    expect(queueTypeOptions(items).map((option) => option.value)).toEqual([
      "collections",
      "pricing",
      "qualification",
      "screening",
    ]);
    const withOwners = [
      assigned(items[0] as QueueItem, {
        ownerId: "usr_amina_cole",
        owner: "Amina Cole",
      }),
      assigned(items[1] as QueueItem, {
        ownerId: "usr_james_kurz",
        owner: "James Kurz",
      }),
    ];
    expect(queueOwnerOptions(withOwners).map((person) => person.label)).toEqual(
      ["Amina Cole", "James Kurz"],
    );
  });
});

describe("queue permission and evidence disclosure", () => {
  it("removes role-gated decision actions without hiding safe evidence work", () => {
    const [collections] = operationalQueue();
    if (!collections) throw new Error("Expected a collections case.");
    const gated = assigned(collections, {
      permittedActions: [
        "Request finance review",
        "Add evidence",
        "Reassign owner",
      ],
      requiredRole: "finance_approver",
    });
    expect(permittedActions(gated, ["internal_operator"])).toEqual([
      "Add evidence",
      "Reassign owner",
    ]);
    expect(permittedActions(gated, ["finance_approver"])).toEqual(
      gated.permittedActions,
    );
  });

  it("keeps technical IDs in an explicit evidence disclosure", async () => {
    const user = userEvent.setup();
    const [, screening] = operationalQueue();
    if (!screening) throw new Error("Expected a screening case.");
    const gated = assigned(screening, {
      permittedActions: ["Request legal review", "Attach screening evidence"],
      requiredRole: "legal_approver",
    });
    const technicalId = gated.evidence.at(-1)?.technicalId as string;
    render(<QueueDetail item={gated} />);
    expect(screen.getByRole("heading", { name: "Evidence" })).toBeVisible();
    const disclosure = screen.getByText("Technical identifier");
    expect(disclosure.closest("details")).not.toHaveAttribute("open");
    await user.click(disclosure);
    expect(screen.getByText(technicalId)).toBeVisible();
    expect(
      screen.getByText(/does not have the required legal approver role/i),
    ).toBeVisible();
  });

  it("labels what the projection omitted instead of implying a value", () => {
    render(
      <QueueDetail
        item={queueItemFromProjection(
          projection("queues", "EXC-1", { title: "Unclassified case" }),
        )}
      />,
    );
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("heading", { name: "Related records" }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Why this needs a decision" }),
    ).toBeNull();
  });
});

describe("split-view selection", () => {
  it("keeps the requested item selected and safely falls back after filtering", () => {
    const items = operationalQueue();
    expect(selectQueueItem(items, "prc-019")?.type).toBe("Pricing");
    expect(selectQueueItem(items.slice(0, 2), "prc-019")?.id).toBe("col-008");
    expect(selectQueueItem([], "prc-019")).toBeNull();
  });
});

describe("grouped global search", () => {
  const searchable: ReadonlyArray<[ProjectionChannel, SearchGroup, string]> = [
    ["dashboard", "Accounts", "acct-northstar"],
    ["agreements", "Agreements", "AGR-2026-0042"],
    ["collections", "Invoices", "INV-2026-0781"],
    ["queues", "Queues", "EXC-COL-008"],
  ];

  function catalog() {
    return searchable.map(([channel, group, key]) =>
      searchRecordFromProjection(
        projection(channel, key, {
          title: `Northstar ${group}`,
          description: `Northstar Archive Labs · ${group}`,
          statusLabel: "Active",
        }),
        group,
        "en-US",
      ),
    );
  }

  it("searches IDs and human-readable fields, then groups by record type", () => {
    const grouped = groupSearchResults(searchRecords("Northstar", catalog()));
    expect(grouped.map((entry) => entry.group)).toEqual([
      "Accounts",
      "Agreements",
      "Invoices",
      "Queues",
    ]);
    expect(searchRecords("EXC-COL-008", catalog())[0]?.title).toBe(
      "Northstar Queues",
    );
    expect(searchRecords("Northstar", [])).toEqual([]);
    expect(searchRecords("", catalog())).toEqual([]);
  });

  it("falls back to the projection context when no description is written", () => {
    const record = searchRecordFromProjection(
      projection("queues", "EXC-1", {
        title: "Pricing exception",
        context: [
          { label: "Queue", value: "Pricing" },
          { label: "Target", value: "Aug 3, 2026" },
        ],
      }),
      "Queues",
      "en-US",
    );
    expect(record.subtitle).toBe("Queue Pricing · Target Aug 3, 2026");
    expect(record.status).toBe("Available");
  });

  it("formats the update time when it is the only available subtitle", () => {
    const record = searchRecordFromProjection(
      projection("orders", "ORD-1", { title: "Archive renewal" }),
      "Orders",
      "en-US",
    );
    expect(record.subtitle).toBe("Updated Jul 31, 2026, 3:42 PM UTC");
    expect(record.subtitle).not.toContain("2026-07-31T");
  });

  it("wraps keyboard navigation in both directions", () => {
    expect(nextSearchIndex(-1, "ArrowDown", 3)).toBe(0);
    expect(nextSearchIndex(2, "ArrowDown", 3)).toBe(0);
    expect(nextSearchIndex(0, "ArrowUp", 3)).toBe(2);
    expect(nextSearchIndex(0, "ArrowDown", 0)).toBe(-1);
  });

  it("keeps every internal search destination inside the internal experience", () => {
    expect(catalog().map((record) => record.href)).toEqual([
      "/internal/accounts/acct-northstar",
      "/internal/agreements",
      "/internal/collections",
      "/internal/queues/EXC-COL-008",
    ]);
  });

  it("routes a record with no operator surface to the account that owns it", () => {
    expect(
      searchRecordFromProjection(
        projection(
          "quotes",
          "quote-9f1",
          { title: "Committed capacity" },
          "10000000-0000-4000-8000-000000000001",
        ),
        "Quotes",
        "en-US",
      ).href,
    ).toBe("/internal/accounts/10000000-0000-4000-8000-000000000001");
    expect(
      searchRecordFromProjection(
        projection("quotes", "quote-9f2", { title: "Committed capacity" }),
        "Quotes",
        "en-US",
        "meridian-archive",
      ).href,
    ).toBe("/internal/accounts/meridian-archive");
  });
});
