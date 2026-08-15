import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalSearch } from "./global-search";
import { QueueWorkspace } from "./queue-workspace";
import type { QueueItem } from "./model";
import type { SearchRecord } from "./search-model";

/**
 * How long the mocked router takes to turn a `replace` into a new
 * `useSearchParams` value. A real client transition is interruptible and not
 * instant; the defect these tests pin only appears when a keystroke lands
 * while an earlier URL is still in flight, so the lag is modelled explicitly
 * rather than left to chance.
 */
const ROUTER_LAG_MS = 100;
const KEYSTROKE_MS = 20;

let search = "";
const listeners = new Set<() => void>();
const paramsBySnapshot = new Map<string, URLSearchParams>();
const replace = vi.fn((url: string) => {
  const next = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  setTimeout(() => {
    search = next;
    for (const listener of listeners) listener();
  }, ROUTER_LAG_MS);
});

function snapshot() {
  return search;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePathname: () => "/internal/queues",
    useSearchParams: () => {
      const value = useSyncExternalStore(subscribe, snapshot, snapshot);
      let params = paramsBySnapshot.get(value);
      if (!params) {
        params = new URLSearchParams(value);
        paramsBySnapshot.set(value, params);
      }
      return params;
    },
    useRouter: () => ({
      replace,
      push: vi.fn(),
      prefetch: vi.fn(),
      refresh: vi.fn(),
    }),
  };
});

function queueItem(overrides: Partial<QueueItem> & { id: string }): QueueItem {
  return {
    title: `Case ${overrides.id}`,
    entity: "Northstar Archive Labs",
    type: "collections",
    owner: "Dana Reyes",
    ownerId: "dana",
    backup: null,
    backupId: null,
    risk: "high",
    status: "open",
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-31T15:42:00.000Z",
    dueAt: "2026-07-30T17:00:00.000Z",
    ageDays: 11,
    summary: null,
    policyReason: null,
    policyBasis: null,
    evidence: [],
    related: [],
    permittedActions: [],
    ...overrides,
  };
}

const items: readonly QueueItem[] = [
  queueItem({ id: "EXC-COL-008", title: "Collections aging decision" }),
  queueItem({
    id: "EXC-SCR-004",
    title: "Screening exception",
    type: "screening",
    risk: "medium",
  }),
];

function renderWorkspace() {
  return render(
    <QueueWorkspace
      roles={["internal_operator"]}
      items={items}
      generatedAt="2026-07-31T16:00:00.000Z"
      stale={false}
      actorId="dana"
    />,
  );
}

/** One character onto whatever the field currently shows, as a key press is. */
function pressKey(field: HTMLInputElement, character: string) {
  fireEvent.change(field, { target: { value: `${field.value}${character}` } });
}

function typeWord(field: HTMLInputElement, word: string) {
  for (const character of word) {
    pressKey(field, character);
    act(() => void vi.advanceTimersByTime(KEYSTROKE_MS));
  }
}

function settle() {
  act(() => void vi.advanceTimersByTime(1_000));
}

describe("operator queue table semantics and keyboard reach", () => {
  beforeEach(() => {
    search = "";
    paramsBySnapshot.clear();
    replace.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  /**
   * The table is wider than its panel on a narrow viewport, so its container
   * scrolls. A scroll container with no focusable element inside it and no tab
   * stop of its own cannot be scrolled from the keyboard at all: the columns
   * past the fold were reachable by pointer only.
   */
  it("gives the scrolling table container a tab stop and a name", () => {
    renderWorkspace();

    const scroller = screen.getByRole("region", {
      name: "Queue results table",
    });
    expect(scroller.tabIndex).toBe(0);
    expect(within(scroller).getByRole("table")).toBeDefined();
  });

  /** The column headers the operator brief promises are really present. */
  it("keeps the column headers in the table", () => {
    renderWorkspace();

    const table = screen.getByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual([
      "Work item",
      "Owner",
      "SLA",
      "Risk",
      "Status",
      "Age",
    ]);
  });
});

describe("operator queue filter typing", () => {
  beforeEach(() => {
    search = "";
    paramsBySnapshot.clear();
    replace.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  /**
   * Every keystroke used to push a URL and an effect reset the field from
   * whichever URL arrived, so a value committed three characters ago
   * overwrote what had been typed since. The field is the authority while an
   * edit is outstanding.
   */
  it("keeps every typed character while the URL is still catching up", () => {
    renderWorkspace();
    const field = screen.getByLabelText<HTMLInputElement>("Search work");

    typeWord(field, "collections");

    expect(field.value).toBe("collections");
    settle();
    expect(field.value).toBe("collections");
    expect(search).toContain("q=collections");
  });

  it("costs one navigation for a typing burst rather than one per character", () => {
    renderWorkspace();
    const field = screen.getByLabelText<HTMLInputElement>("Search work");

    typeWord(field, "collections");
    settle();

    expect(replace).toHaveBeenCalledTimes(1);
  });

  /**
   * A debounce must not swallow work. Changing a filter before the pause has
   * elapsed carries the outstanding keystrokes into the same URL rather than
   * dropping them.
   */
  it("carries outstanding keystrokes into a filter change", () => {
    renderWorkspace();
    const field = screen.getByLabelText<HTMLInputElement>("Search work");

    typeWord(field, "coll");
    fireEvent.change(screen.getByLabelText("Risk"), {
      target: { value: "high" },
    });
    settle();

    expect(field.value).toBe("coll");
    expect(search).toContain("q=coll");
    expect(search).toContain("risk=high");
  });

  /** Clearing has to clear, including any keystroke not yet committed. */
  it("clears an uncommitted search when the filters are cleared", () => {
    renderWorkspace();
    const field = screen.getByLabelText<HTMLInputElement>("Search work");

    typeWord(field, "coll");
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    settle();

    expect(field.value).toBe("");
    expect(search).not.toContain("q=");
  });
});

const searchRecords: readonly SearchRecord[] = [
  {
    id: "EXC-COL-008",
    group: "Queues",
    title: "Collections aging decision",
    subtitle: "Northstar Archive Labs",
    href: "/internal/queues/EXC-COL-008",
    status: "Open",
  },
  {
    id: "EXC-SCR-004",
    group: "Queues",
    title: "Screening exception",
    subtitle: "Northstar Archive Labs",
    href: "/internal/queues/EXC-SCR-004",
    status: "Open",
  },
];

describe("global search keyboard model", () => {
  beforeEach(() => {
    search = "q=northstar";
    paramsBySnapshot.clear();
    replace.mockClear();
  });

  /**
   * `aria-activedescendant` and real focus movement are alternatives, not
   * companions: the first tells assistive technology the cursor is on an
   * element the input owns while the caret stays in the input, the second
   * moves the caret. Running both left the two disagreeing.
   */
  it("moves real focus through results and claims no virtual cursor", () => {
    render(<GlobalSearch records={searchRecords} />);
    const field = screen.getByLabelText(
      "Search accounts, records, and documents",
    );

    fireEvent.keyDown(field, { key: "ArrowDown" });

    const first = screen.getByRole("link", {
      name: "Collections aging decision",
    });
    expect(document.activeElement).toBe(first);
    expect(field).not.toHaveAttribute("aria-activedescendant");

    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "Screening exception" }),
    );
    expect(field).not.toHaveAttribute("aria-activedescendant");
  });

  it("returns focus to the field on Escape", () => {
    render(<GlobalSearch records={searchRecords} />);
    const field = screen.getByLabelText(
      "Search accounts, records, and documents",
    );

    fireEvent.keyDown(field, { key: "ArrowDown" });
    const first = screen.getByRole("link", {
      name: "Collections aging decision",
    });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "Escape" });
    expect(document.activeElement).toBe(field);
  });
});
