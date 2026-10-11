import { beforeEach, expect, it, vi } from "vitest";
import type { McpToolContext } from "./tool";

const mocks = vi.hoisted(() => ({
  staff: vi.fn(),
  pricing: vi.fn(),
  handoffs: vi.fn(),
  partners: vi.fn(),
  owners: vi.fn(),
}));
vi.mock("@/src/auth/session", () => ({
  explicitDemoIdentityEnabled: () => false,
  getRequestCommerceSession: mocks.staff,
}));
vi.mock("@/src/features/internal-ops/contracts/server", () => ({
  contractStaff: mocks.staff,
  sessionHas: vi.fn(),
}));
vi.mock(
  "@/src/features/internal-ops/sales-pricing/scenario-server",
  async (original) => ({
    ...(await original<object>()),
    scenarioRepository: () => ({ listPage: mocks.pricing }),
  }),
);
vi.mock("@/src/features/internal-ops/sales-pricing/scenario-actions", () => ({
  saveScenario: vi.fn(),
}));
vi.mock("@/src/features/internal-ops/handoff/server", () => ({
  handoffRepository: () => ({ listPage: mocks.handoffs }),
}));
vi.mock("@/src/features/internal-ops/handoff/actions", () => ({
  requestHandoff: vi.fn(),
}));
vi.mock("@/src/features/internal-ops/partners/server", () => ({
  partnerRepository: () => ({ listPage: mocks.partners, owners: mocks.owners }),
  partnerToday: () => "2026-10-11",
  loadPartner: vi.fn(),
}));
vi.mock("@/src/features/internal-ops/partners/actions", () => ({
  savePartner: vi.fn(),
  savePartnerDeal: vi.fn(),
}));

const { listPricingScenarios } = await import("./tools/pricing");
const { listHandoffs } = await import("./tools/handoffs");
const { listPartners } = await import("./tools/partners");
const userId = "20000000-0000-4000-8000-000000000001";
const context = () =>
  ({ origin: "https://commerce.fil.one", targets: {} }) as McpToolContext;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.staff.mockResolvedValue({ userId, roles: ["revenue"] });
  for (const method of [mocks.pricing, mocks.handoffs, mocks.partners])
    method.mockResolvedValue({ rows: [], nextCursor: "next-page" });
  mocks.owners.mockResolvedValue([]);
});

it.each([false, true])(
  "forwards pricing pagination while respecting administrator=%s scope",
  async (admin) => {
    mocks.staff.mockResolvedValue({
      userId,
      roles: [admin ? "commerce_admin" : "revenue"],
    });
    expect(
      await listPricingScenarios.run(
        { limit: 7, cursor: "previous-page" },
        context(),
      ),
    ).toMatchObject({ scenarios: [], nextCursor: "next-page" });
    expect(mocks.staff).toHaveBeenCalledWith("sales:read");
    expect(mocks.pricing).toHaveBeenCalledWith(
      admin ? { kind: "all" } : { kind: "own", ownerId: userId },
      { limit: 7, cursor: "previous-page" },
    );
  },
);
it.each(["mine", "queue"])(
  "filters %s handoffs in the repository before limiting",
  async (scope) => {
    expect(
      await listHandoffs.run(
        { scope, status: "open", limit: 3, cursor: "previous-page" },
        context(),
      ),
    ).toMatchObject({ handoffs: [], nextCursor: "next-page" });
    expect(mocks.staff).toHaveBeenCalledWith(
      scope === "mine" ? "contract:write" : "operations:read",
    );
    expect(mocks.handoffs).toHaveBeenCalledWith(
      scope === "mine" ? { kind: "own", userId } : { kind: "all" },
      "open",
      { limit: 3, cursor: "previous-page" },
    );
  },
);
it("forwards partner filters, viewer scope and cursor without a capped UI read", async () => {
  expect(
    await listPartners.run(
      {
        search: "Northwind",
        status: "active",
        mine: true,
        limit: 11,
        cursor: "previous-page",
      },
      context(),
    ),
  ).toMatchObject({ partners: [], nextCursor: "next-page", owners: [] });
  expect(mocks.staff).toHaveBeenCalledWith("sales:read");
  expect(mocks.partners).toHaveBeenCalledWith(
    expect.objectContaining({ q: "Northwind", status: "active", mine: true }),
    { viewerId: userId, today: "2026-10-11" },
    { limit: 11, cursor: "previous-page" },
  );
});
it.each([listPricingScenarios, listHandoffs, listPartners])(
  "refuses $name before repository access when permission is missing",
  async (tool) => {
    mocks.staff.mockRejectedValue(new Error("CONTRACT_FORBIDDEN"));
    await expect(tool.run({}, context())).rejects.toThrow("CONTRACT_FORBIDDEN");
    expect(mocks.pricing).not.toHaveBeenCalled();
    expect(mocks.handoffs).not.toHaveBeenCalled();
    expect(mocks.partners).not.toHaveBeenCalled();
  },
);
