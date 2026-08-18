import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILTERS,
  parseQueueFilters,
  SAVED_VIEWS,
} from "../queue-search/model";
import { OperationsHome } from "./operations-home";
import type { OperationsHomeData } from "./server-loader";

const data: OperationsHomeData = {
  generatedAt: "2026-08-15T09:15:00.000Z",
  staleChannels: ["collections"],
  signals: [
    {
      label: "Queue work",
      value: "2 cases",
      detail: "1 case needs priority attention.",
      channel: "queues",
      generatedAt: "2026-08-15T09:14:00.000Z",
      stale: false,
      href: "/internal/queues",
      action: "Open the queue",
      tone: "critical",
    },
    {
      label: "Collections",
      value: "$1,200.00",
      detail: "1 invoice is past due, out of 2 open invoices.",
      channel: "collections",
      generatedAt: "2026-08-15T09:15:00.000Z",
      stale: true,
      href: "/internal/collections",
      action: "Open collections",
      tone: "warning",
    },
  ],
};

describe("OperationsHome", () => {
  it("presents readable update times for each work area", () => {
    render(<OperationsHome data={data} />);

    expect(
      screen.getByText("Aug 15, 2026, 9:14 AM UTC", { selector: "time" }),
    ).toBeVisible();
    expect(
      screen.getAllByText("Aug 15, 2026, 9:15 AM UTC", { selector: "time" })
        .length,
    ).toBeGreaterThan(0);
  });

  /**
   * The retired page printed "Operational snapshot refreshed 4 minutes ago"
   * over six frozen constants, and each row carried its own invented age.
   */
  it("prints no relative freshness and no invented owner", () => {
    const { container } = render(<OperationsHome data={data} />);

    expect(container.textContent).not.toMatch(/minutes? ago|min ago/u);
    expect(screen.queryByText("Owner")).toBeNull();
  });

  /**
   * The label says "my queue", so this binds the destination to a view that is
   * the operator's own work and not the default. It reads the href back
   * through `parseQueueFilters` -- the same parser `QueueWorkspace` applies to
   * `useSearchParams` -- so it fails both if the query string is dropped and
   * if it names a view, sort or page size the queue surface would discard.
   */
  it("sends 'Open my queue' to the assigned view rather than to everyone's", () => {
    render(<OperationsHome data={data} />);

    const href = screen
      .getByRole("link", { name: "Open my queue" })
      .getAttribute("href");
    expect(href).toBeTruthy();
    const [path, query] = (href ?? "").split("?");
    expect(path).toBe("/internal/queues");

    const filters = parseQueueFilters(new URLSearchParams(query ?? ""));
    expect(filters.view).toBe("assigned-to-me");
    expect(filters.view).not.toBe(DEFAULT_FILTERS.view);
    expect(SAVED_VIEWS.map((view) => view.id)).toContain(filters.view);
    // `sort` names an ordering `sortQueueItems` implements rather than the
    // `priority` that fell through to the default while leaving the sort
    // control matching nothing. `sort` and `page` restate the parser's own
    // defaults so the link is a complete queue state; `view` and `pageSize`
    // do not.
    expect(filters.sort).toBe("sla-risk-age");
    expect(filters.page).toBe(1);
    expect(filters.pageSize).toBe(25);
    expect(filters.pageSize).not.toBe(DEFAULT_FILTERS.pageSize);
  });

  it("names the stale channels rather than the page as a whole", () => {
    render(<OperationsHome data={data} />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("collections");
  });
});
