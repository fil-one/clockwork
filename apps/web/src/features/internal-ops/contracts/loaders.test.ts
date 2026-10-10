import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureRecord } from "../../../../../../packages/contracts/src/mnda-fixture";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  mnda: { get: vi.fn() },
}));
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.session,
  getRequestCommerceSession: mocks.session,
  explicitDemoIdentityEnabled: () => false,
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: vi.fn() }));
vi.mock("../mnda/server", () => ({ mndaRepository: () => mocks.mnda }));
import { loadContractForm } from "./loaders";

const signed = {
  ...fixtureRecord,
  state: "completed" as const,
  completedAt: "2026-09-28T17:30:00.000Z",
};
const as = (permissions: string[]) =>
  mocks.session.mockResolvedValue({
    userId: "019a44ac-0000-7000-8000-0000000000aa",
    profile: { name: "Seller", email: "seller@fil.one" },
    roles: ["revenue"],
    permissions,
    isInternalStaff: true,
    mfaVerified: true,
  });

beforeEach(() => {
  vi.clearAllMocks();
  as(["mnda:send", "contract:read", "contract:write"]);
  mocks.mnda.get.mockResolvedValue(signed);
});

describe("recording a contract from an MNDA", () => {
  it("fills the form from a signed MNDA", async () => {
    await expect(loadContractForm(undefined, signed.id)).resolves.toMatchObject(
      {
        kind: "ready",
        mnda: {
          id: signed.id,
          company: signed.input.company,
          signerName: signed.input.signerName,
          signedOn: "2026-09-28",
        },
      },
    );
    expect(mocks.mnda.get).toHaveBeenCalledWith(signed.id);
  });

  it("starts an empty form for an MNDA the reader cannot use", async () => {
    // Not signed yet.
    mocks.mnda.get.mockResolvedValueOnce({ ...signed, state: "sent" });
    await expect(loadContractForm(undefined, signed.id)).resolves.toMatchObject(
      { kind: "ready", mnda: null },
    );
    // Unknown.
    mocks.mnda.get.mockRejectedValueOnce(new Error("MNDA_NOT_FOUND"));
    await expect(loadContractForm(undefined, signed.id)).resolves.toMatchObject(
      { kind: "ready", mnda: null },
    );
    // Not an id.
    await expect(loadContractForm(undefined, "../../x")).resolves.toMatchObject(
      { kind: "ready", mnda: null },
    );
    expect(mocks.mnda.get).toHaveBeenCalledTimes(2);
    // A reader outside the MNDA register never reads it.
    as(["contract:read", "contract:write"]);
    await expect(loadContractForm(undefined, signed.id)).resolves.toMatchObject(
      { kind: "ready", mnda: null },
    );
    expect(mocks.mnda.get).toHaveBeenCalledTimes(2);
  });
});
