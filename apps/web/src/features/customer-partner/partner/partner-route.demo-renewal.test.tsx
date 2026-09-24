import { describe, expect, it, vi } from "vitest";

import { createPristineDemoAdapterState } from "@clockwork/testing/demo-state";
import { demoAccountIds } from "@clockwork/testing/personas";

const mocks = vi.hoisted(() => ({
  getRouteSession: vi.fn(),
  loadPartnerRecords: vi.fn(),
  partnerRouteMembership: vi.fn(),
  readState: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/auth/demo-deploy", () => ({
  demoDeployIdentityEnabled: () => true,
}));
vi.mock("@/src/features/shell/route-session", () => ({
  getRouteSession: mocks.getRouteSession,
}));
vi.mock("@/src/features/experience-server/portal-view-loader", () => ({
  loadPartnerRecords: mocks.loadPartnerRecords,
}));
vi.mock("@/src/features/experience-server/demo-state-store", () => ({
  configuredDemoStateStore: () => ({ read: mocks.readState }),
}));
vi.mock("./partner-membership", () => ({
  NoPartnerMembership: () => null,
  partnerRouteMembership: mocks.partnerRouteMembership,
}));

import { PartnerCollection } from "./partner-collection";
import { translatorFor } from "@/src/i18n/catalogs";

import { presentedPartnerSurface } from "./partner-surface.test-fixture";
import { PartnerCollectionRoute } from "./partner-route";

describe("guided partner renewal route", () => {
  it("binds the collection CTA to the same hidden order as the portfolio", async () => {
    mocks.getRouteSession.mockResolvedValue({
      roles: ["partner_admin"],
      locale: "en-US",
      timeZone: "UTC",
    });
    mocks.partnerRouteMembership.mockReturnValue({
      accountId: demoAccountIds.reseller,
      accountName: "Aurora Systems",
    });
    mocks.loadPartnerRecords.mockResolvedValue({
      records: presentedPartnerSurface(
        "renewals",
        translatorFor("en"),
        "en",
      ).records.slice(0, 1),
      generatedAt: "2026-08-18T12:00:00.000Z",
      truncated: false,
      stale: false,
    });
    mocks.readState.mockResolvedValue(createPristineDemoAdapterState());

    const result = await PartnerCollectionRoute({ surface: "renewals" });

    expect(result.type).toBe(PartnerCollection);
    expect(result).toMatchObject({
      props: {
        renewalContext: {
          accountId: demoAccountIds.resaleEndClient,
          orderId: "demo-partner-renewal-ec-0038",
        },
      },
    });
  });
});
