import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as DatabaseModule from "@clockwork/db";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  save: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/src/auth/session", () => ({
  requireRecentAuthentication: mocks.session,
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@clockwork/db", async (original) => ({
  ...(await original<typeof DatabaseModule>()),
  DatabaseCatalogAdmin: class {
    save = mocks.save;
  },
}));
import { saveCatalogMapping } from "./actions";
const staff = {
  userId: "20000000-0000-4000-8000-000000000001",
  providerBacked: true,
  isInternalStaff: true,
  mfaVerified: true,
  roles: ["internal_operator"],
};
function form() {
  const data = new FormData();
  Object.entries({
    rateCardId: "00000000-0000-4000-8000-000000000001",
    expectedRowVersion: "2",
    providerSku: "object",
    providerRegion: "fr",
    meterId: "byte_hours",
    sourceEvidence: "evidence:mapping",
    reason: "Confirmed source reference",
  }).forEach(([key, value]) => data.set(key, value));
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(staff);
});
describe("catalog mapping administration", () => {
  it.each([
    { providerBacked: false },
    { assistedSession: {} },
    { impersonation: {} },
    { mfaVerified: false },
    { roles: ["legal_approver"] },
  ])("denies unsupported authority %j", async (change) => {
    mocks.session.mockResolvedValue({ ...staff, ...change });
    const data = form();
    data.set("$ACTION_ID_fixture", "framework metadata");
    data.set("actor", "forged actor");
    expect(await saveCatalogMapping("", data)).toBe("forbidden");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("binds the real actor, preserves reviewed version, and refreshes both surfaces", async () => {
    const data = form();
    data.set("$ACTION_ID_fixture", "framework metadata");
    data.set("actor", "forged actor");
    expect(await saveCatalogMapping("", data)).toBe("saved");
    expect(mocks.save.mock.calls[0]?.[0]).toMatchObject({
      actor: { kind: "user", id: staff.userId },
      command: { expectedRowVersion: 2 },
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/internal/catalog");
    expect(mocks.revalidate).toHaveBeenCalledWith("/internal/price-books");
  });
  it("rejects unsafe evidence without a mutation", async () => {
    const data = form();
    data.set("sourceEvidence", "not-a-reference");
    expect(await saveCatalogMapping("", data)).toBe("invalid");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("reports a concurrent proposal without claiming success", async () => {
    mocks.save.mockRejectedValueOnce(new Error("CATALOG_DRAFT_FROZEN"));
    expect(await saveCatalogMapping("", form())).toBe("frozen");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("tells a stale edit apart from a failure, and claims neither as saved", async () => {
    mocks.save.mockRejectedValueOnce(new Error("CATALOG_VERSION_CONFLICT"));
    expect(await saveCatalogMapping("", form())).toBe("conflict");
    mocks.save.mockRejectedValueOnce(new Error("connection reset"));
    expect(await saveCatalogMapping("", form())).toBe("failed");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
