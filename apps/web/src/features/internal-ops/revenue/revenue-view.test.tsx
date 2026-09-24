import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RevenueView } from "./revenue-view";

describe("revenue view", () => {
  it("states stage and basis boundaries beside real report values", () => {
    render(
      <RevenueView
        now={new Date("2026-08-16T12:00:00Z")}
        workspace={{
          readable: true,
          source: "core_revenue_forecast and core_arr_mrr",
          forecastRowCount: 2,
          remainingBacklogRowCount: 1,
          recurringContractCount: 1,
          stages: [
            {
              stage: "pipeline",
              currency: "USD",
              revenueBasis: "gross",
              revenueMinor: "120000",
              quoteCount: 1,
              orderCount: 0,
            },
          ],
          channels: [
            {
              channel: "resale",
              merchantOfRecord: "partner",
              currency: "USD",
              revenueBasis: "transfer_price",
              revenueMinor: "90000",
              orderCount: 1,
            },
          ],
          months: [
            {
              month: "2026-08-01",
              currency: "USD",
              revenueBasis: "transfer_price",
              revenueMinor: "90000",
              orderCount: 1,
            },
          ],
          recurring: [
            {
              currency: "USD",
              revenueBasis: "transfer_price",
              methodologyVersion: "merchant_of_record.v1",
              mrrMinor: "90000",
              arrMinor: "1080000",
              contractCount: 1,
            },
          ],
        }}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Revenue & channel" }),
    ).toBeVisible();
    expect(screen.getByText(/not probability-weighted/i)).toBeVisible();
    expect(screen.getAllByText(/not gross/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Merchant-of-record basis · v1")).toBeVisible();
    expect(screen.getByText("Resale")).toBeVisible();
    expect(screen.getByText("Partner")).toBeVisible();
    expect(screen.getByText("Aug 2026")).toBeVisible();
  });
});
