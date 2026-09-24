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
  DatabaseProviderReferenceAdmin: class {
    save = mocks.save;
  },
}));
import { translatorFor } from "@/src/i18n/catalogs";
import { saveProviderReference, type ProviderReferenceResult } from "./actions";

/** The action returns a message ID; read it the way an English reader sees it. */
const english = translatorFor("en");
async function said(result: Promise<ProviderReferenceResult>) {
  const id = await result;
  return id ? english(id) : "";
}
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
    provider: "billing",
    expectedRowVersion: "2",
    secretReference: "vault:commerce/billing/credential",
    secretVersion: "version-2",
    rotatedAt: "2026-09-01T12:00:00.000Z",
    owner: "Finance operations",
    reviewIntervalDays: "60",
    sourceEvidence: "evidence:provider-reference",
    reason: "Confirmed rotation evidence",
  }).forEach(([key, value]) => data.set(key, value));
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(staff);
});
describe("provider reference administration", () => {
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
    expect(await said(saveProviderReference("", data))).toContain(
      "directly authenticated",
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("binds the real actor, preserves reviewed version, and refreshes the registry", async () => {
    const data = form();
    data.set("$ACTION_ID_fixture", "framework metadata");
    data.set("actor", "forged actor");
    expect(await said(saveProviderReference("", data))).toContain(
      "Reference saved",
    );
    expect(mocks.save.mock.calls[0]?.[0]).toMatchObject({
      actor: { kind: "user", id: staff.userId },
      command: { expectedRowVersion: 2 },
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/internal/providers");
  });
  it("rejects unsafe evidence without a mutation", async () => {
    const data = form();
    data.set("sourceEvidence", "not-a-reference");
    expect(await said(saveProviderReference("", data))).toContain("Check");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("reports a concurrent edit without claiming success", async () => {
    mocks.save.mockRejectedValueOnce(
      new Error("PROVIDER_REFERENCE_VERSION_CONFLICT"),
    );
    expect(await said(saveProviderReference("", form()))).toContain(
      "changed while",
    );
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
