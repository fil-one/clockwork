import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRouteRoles: vi.fn(),
  loadPartnerRecords: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/auth/demo-deploy", () => ({
  demoDeployIdentityEnabled: () => false,
}));
vi.mock("@/src/features/shell/route-session", () => ({
  getRouteIdentity: vi.fn(),
  getRouteRoles: mocks.getRouteRoles,
}));
vi.mock("@/src/features/experience-server/portal-view-loader", () => ({
  loadPartnerRecords: mocks.loadPartnerRecords,
}));

import type { PartnerStatus } from "./partner-data";
import { PartnerQuoteDetail } from "./partner-detail";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRouteRoles.mockResolvedValue(["partner_admin"]);
});

describe("partner quote detail creation actions", () => {
  it.each<PartnerStatus>(["draft", "open", "canceled"])(
    "labels the %s quote link as a new quote rather than an edit or revision",
    async (status) => {
      mocks.loadPartnerRecords.mockResolvedValue({
        records: [
          {
            id: "PQ-2026-0184-v3",
            recordKey: "PQ-2026-0184-v3",
            name: "Halcyon capacity quote",
            context: "Resale · US East",
            status,
            risk: "low",
            owner: "Juno Okafor",
            value: "$91,200 transfer / $112,000 resale",
            secondary: "Expires Sep 30",
          },
        ],
      });

      render(await PartnerQuoteDetail({ id: "PQ-2026-0184-v3" }));

      expect(
        screen.getByRole("link", { name: "Create a new quote" }),
      ).toHaveAttribute("href", "/partner/quotes/new");
      expect(
        screen.queryByRole("link", { name: /edit|revise|revision/i }),
      ).not.toBeInTheDocument();
    },
  );
});

it("shows the saved transfer and resale amounts on that quote's detail", async () => {
  mocks.loadPartnerRecords.mockResolvedValue({
    records: [
      {
        id: "quote-current",
        recordKey: "quote-current",
        name: "Current customer quote",
        context: "Resale",
        status: "draft",
        risk: "low",
        owner: "Partner",
        value: "Commercial position",
        secondary: "Expires tomorrow",
        quotePricing: {
          transferPrice: "£39,600.00",
          resalePrice: "£50,000.00",
        },
      },
    ],
  });
  render(await PartnerQuoteDetail({ id: "quote-current" }));
  expect(screen.getByText("£39,600.00")).toBeVisible();
  expect(screen.getByText("£50,000.00")).toBeVisible();
  expect(screen.queryByText("Not recorded")).toBeNull();
});
