import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRouteSession: vi.fn(),
  loadPartnerRecords: vi.fn(),
  partnerRouteMembership: vi.fn(),
}));

vi.mock("@/src/features/shell/route-session", () => ({
  getRouteSession: mocks.getRouteSession,
}));
vi.mock("@/src/features/experience-server/portal-view-loader", () => ({
  loadPartnerRecords: mocks.loadPartnerRecords,
}));
vi.mock("./partner-membership", () => ({
  NoPartnerMembership: () => <p>No partner membership</p>,
  partnerRouteMembership: mocks.partnerRouteMembership,
}));

import { PartnerCollection } from "./partner-collection";
import { partnerSurfaces, type PartnerSurfaceKey } from "./partner-data";
import { PartnerCollectionRoute } from "./partner-route";

const adminOnlySurfaces = Object.entries(partnerSurfaces)
  .filter(([, config]) =>
    config.roles.every((role) => role === "partner_admin"),
  )
  .map(([surface]) => surface as PartnerSurfaceKey);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRouteSession.mockResolvedValue({
    roles: ["partner_seller"],
    locale: "en-US",
    timeZone: "UTC",
  });
  mocks.partnerRouteMembership.mockReturnValue({
    accountName: "Meridian Partners",
  });
  mocks.loadPartnerRecords.mockResolvedValue({
    records: [{ id: "SECRET-COMMISSION-RECORD" }],
    generatedAt: "2026-08-16T12:00:00.000Z",
    truncated: false,
    stale: false,
  });
});

describe("PartnerCollectionRoute authorization", () => {
  it.each(adminOnlySurfaces)(
    "does not read or serialize %s records for a partner seller",
    async (surface) => {
      const result = await PartnerCollectionRoute({ surface });

      expect(mocks.loadPartnerRecords).not.toHaveBeenCalled();
      const { container } = render(result);
      expect(
        screen.getByText("This information is not available to your role"),
      ).toBeVisible();
      expect(container).not.toHaveTextContent("SECRET-COMMISSION-RECORD");
    },
  );

  it("loads an admin-only surface for a partner administrator", async () => {
    mocks.getRouteSession.mockResolvedValue({
      roles: ["partner_admin"],
      locale: "en-US",
      timeZone: "UTC",
    });
    mocks.loadPartnerRecords.mockResolvedValue({
      records: [],
      generatedAt: "2026-08-16T12:00:00.000Z",
      truncated: false,
      stale: false,
    });

    const result = await PartnerCollectionRoute({ surface: "commissions" });

    expect(mocks.loadPartnerRecords).toHaveBeenCalledWith("commissions");
    expect(result.type).toBe(PartnerCollection);
  });

  it("preserves a validated assisted internal read of the selected partner", async () => {
    mocks.getRouteSession.mockResolvedValue({
      roles: ["internal_operator"],
      locale: "en-US",
      timeZone: "UTC",
      assistedSession: { accountId: "10000000-0000-4000-8000-000000000002" },
    });
    mocks.loadPartnerRecords.mockResolvedValue({
      records: [],
      generatedAt: "2026-08-16T12:00:00.000Z",
      truncated: false,
      stale: false,
    });

    const result = await PartnerCollectionRoute({ surface: "commissions" });

    expect(mocks.loadPartnerRecords).toHaveBeenCalledWith("commissions");
    expect(result.type).toBe(PartnerCollection);
  });
});
