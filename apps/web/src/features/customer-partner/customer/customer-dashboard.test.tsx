import { render, screen } from "@testing-library/react";
import type { Route } from "next";
import { describe, expect, it } from "vitest";

import {
  CustomerDashboard,
  type CustomerDashboardProjection,
} from "./customer-dashboard";

function obligation(index: number) {
  return {
    id: `OBL-${index}`,
    priority: index,
    type: "Renewal",
    title: `Decision ${index}`,
    detail: "Confirm before the notice window closes.",
    actionLabel: "Open",
    href: "/agreements" as Route,
    tone: "warning" as const,
    state: "Open",
    recordVersion: 1,
  };
}

function projection(count: number): CustomerDashboardProjection {
  return {
    generatedAt: "2026-08-14T13:04:00Z",
    stale: false,
    obligations: Array.from({ length: count }, (_, index) =>
      obligation(index + 1),
    ),
    term: {
      title: "Northstar master agreement",
      rangeLabel: "Jan 1, 2026 – Dec 31, 2026",
      progressPercent: 62,
      progressLabel: "62 percent of the term elapsed",
      renewalState: "Auto-renews",
      noticeLabel: "Opens Oct 2, 2026",
      renewalLabel: "Jan 1, 2027",
      agreementLabel: "CSA v4",
    },
    services: [],
    capacity: null,
    activity: [],
  };
}

const london = { locale: "en-GB", timeZone: "Europe/London" };
const newYork = { locale: "en-US", timeZone: "America/New_York" };

/**
 * Both halves fail against the unfixed dashboard: the sentence above the list
 * was the constant "Four items need a decision or follow-up." regardless of
 * length, and the timestamp beside it was rendered in `America/New_York` for
 * every reader with no zone label.
 */
describe("customer dashboard attention summary", () => {
  it("counts the list it introduces rather than asserting four", () => {
    render(
      <CustomerDashboard
        formatting={newYork}
        greetingName="Mara"
        projection={projection(2)}
      />,
    );

    expect(
      screen.getByText("2 items need a decision or follow-up."),
    ).toBeVisible();
    expect(screen.queryByText(/Four items/)).toBeNull();
  });

  it("uses the singular for one and a sentence of its own for none", () => {
    const { rerender } = render(
      <CustomerDashboard
        formatting={newYork}
        greetingName="Mara"
        projection={projection(1)}
      />,
    );
    expect(
      screen.getByText("1 item needs a decision or follow-up."),
    ).toBeVisible();

    rerender(
      <CustomerDashboard
        formatting={newYork}
        greetingName="Mara"
        projection={projection(0)}
      />,
    );
    expect(
      screen.getByText("Nothing needs a decision or follow-up."),
    ).toBeVisible();
  });
});

describe("customer dashboard timestamps", () => {
  it("renders the reader's own zone and names it", () => {
    render(
      <CustomerDashboard
        formatting={london}
        greetingName="Iris"
        projection={projection(1)}
      />,
    );

    // 13:04Z is 14:04 in London during British Summer Time. The unfixed
    // dashboard showed 9:04 AM with nothing saying it was a New York clock.
    const asOf = screen.getByText(/Account facts as of/);
    expect(asOf).toHaveTextContent("14:04");
    expect(asOf).toHaveTextContent("BST");
  });

  it("keeps the machine-readable instant on the time element", () => {
    render(
      <CustomerDashboard
        formatting={london}
        greetingName="Iris"
        projection={projection(1)}
      />,
    );

    expect(
      screen.getByText(/Account facts as of/).querySelector("time"),
    ).toHaveAttribute("dateTime", "2026-08-14T13:04:00Z");
  });
});
