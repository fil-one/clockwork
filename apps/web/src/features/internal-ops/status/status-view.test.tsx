import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/features/contracts/status-client", () => ({
  readGeneratedLaneStatus: vi.fn((_baseUrl: string, lane: string) =>
    Promise.resolve(
      // The demo API answers the system lane with no `details` at all.
      lane === "system"
        ? { lane, status: "ready" }
        : {
            lane,
            status: "ready",
            details:
              lane === "core"
                ? { service: "database", stripeWebhook: "missing" }
                : {},
          },
    ),
  ),
}));

import { readGeneratedLaneStatus } from "@/src/features/contracts/status-client";
import { IntegrationStatusView } from "./status-view";

describe("integration status view", () => {
  it("uses the generated status reader and presents operator-facing counts", async () => {
    render(
      <IntegrationStatusView
        queues={{
          dispatch: 2,
          provisioning: 1,
          workflow: 0,
          webhook: 3,
          deadLettersReadable: true,
          webhooksReadable: true,
        }}
        now={new Date("2026-08-16T12:00:00Z")}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Integration status" }),
    ).toBeVisible();
    expect(
      screen.getAllByText("Items currently waiting for operator attention"),
    ).toHaveLength(4);
    expect(screen.queryByText(/first 100 records read/i)).toBeNull();
    expect(await screen.findByText("Service store")).toBeVisible();
    // Every lane renders, including the one that reported no details, and
    // the values are worded rather than printed as contract codes.
    expect(screen.getByText("Operations")).toBeVisible();
    expect(screen.getAllByText("Ready")).toHaveLength(3);
    expect(screen.getByText("Connected")).toBeVisible();
    expect(screen.getByText("Not configured")).toBeVisible();
    expect(readGeneratedLaneStatus).toHaveBeenCalledTimes(3);
    expect(readGeneratedLaneStatus).toHaveBeenCalledWith(
      "http://localhost:3000/api",
      "core",
    );
    expect(screen.getByRole("link", { name: "Open recovery" })).toHaveAttribute(
      "href",
      "/internal/recovery",
    );
  });
});
