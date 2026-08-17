import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  PartnerDashboard,
  type PartnerDashboardProjection,
} from "./partner-dashboard";

const projection: PartnerDashboardProjection = {
  generatedAt: "2026-07-31T16:00:00.000Z",
  stale: false,
  agreement: {
    label: "Meridian agreement",
    start: "2026-01-01T00:00:00.000Z",
    noticeStart: "2026-09-01T00:00:00.000Z",
    end: "2026-12-31T00:00:00.000Z",
    now: "2026-07-31T16:00:00.000Z",
    renewalState: "auto-renews",
    authorityState: "Active",
    nextDecision: "No decision pending",
    commercialRoute: "Referral",
    merchantBoundary: "Fil One",
  },
  work: [],
  commission: {
    id: "STM-2026-Q3",
    statement: "Q3 commission statement",
    accruedAmount: "$18,420 accrued",
    href: "/partner/commissions?q=STM-2026-Q3",
  },
  boundary: [],
};

const formatting = { locale: "en-GB", timeZone: "Europe/London" };

describe("partner dashboard commission position", () => {
  it("shows a sourced named position to a partner administrator", () => {
    render(
      <PartnerDashboard
        formatting={formatting}
        projection={projection}
        roles={["partner_admin"]}
      />,
    );

    const heading = screen.getByRole("heading", {
      name: "Commission position",
    });
    expect(heading).toBeVisible();
    expect(screen.getByText("Statement")).toBeVisible();
    expect(screen.getByText("$18,420 accrued")).toBeVisible();
    expect(
      screen.getByText(
        "Referral earnings accrue on net collected revenue and statements net refunds, credits, and chargebacks.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open Q3 commission statement" }),
    ).toHaveAttribute("href", "/partner/commissions?q=STM-2026-Q3");
  });

  it("does not disclose the position to a partner seller", () => {
    render(
      <PartnerDashboard
        formatting={formatting}
        projection={projection}
        roles={["partner_seller"]}
      />,
    );

    expect(
      screen.queryByRole("heading", { name: "Commission position" }),
    ).toBeNull();
    expect(screen.queryByText("$18,420 accrued")).toBeNull();
  });

  it("does not render a placeholder when the loader has no record", () => {
    const projectionWithoutCommission = { ...projection };
    delete projectionWithoutCommission.commission;
    render(
      <PartnerDashboard
        formatting={formatting}
        projection={projectionWithoutCommission}
        roles={["partner_admin"]}
      />,
    );

    expect(
      screen.queryByRole("heading", { name: "Commission position" }),
    ).toBeNull();
  });
});
