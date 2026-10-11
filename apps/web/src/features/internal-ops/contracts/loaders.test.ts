import type * as Server from "./server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fixtureContractRecord,
  fixtureSigningRecord,
} from "../../../../../../packages/contracts/src/contract-fixture";
import { fixtureRecord } from "../../../../../../packages/contracts/src/mnda-fixture";
import { fixtureContractTemplateRegistry } from "../../../../../../packages/documents/src/__fixtures__/contract-template";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  mnda: { get: vi.fn() },
  contracts: { get: vi.fn() },
  signing: { get: vi.fn(), countersigners: vi.fn() },
}));
vi.mock("./server", async (original) => ({
  ...(await original<typeof Server>()),
  contractRepository: () => mocks.contracts,
  contractSigningRepository: () => mocks.signing,
  contractTemplateRegistry: () => fixtureContractTemplateRegistry,
}));
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.session,
  getRequestCommerceSession: mocks.session,
  explicitDemoIdentityEnabled: () => false,
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: vi.fn() }));
vi.mock("../mnda/server", () => ({ mndaRepository: () => mocks.mnda }));
import {
  counterpartyPaperSources,
  loadContractForm,
  loadPrepare,
} from "./loaders";

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

describe("preparing a template again for someone else", () => {
  beforeEach(() => {
    mocks.signing.countersigners.mockResolvedValue([]);
    mocks.signing.get.mockResolvedValue({
      ...fixtureSigningRecord,
      contractId: fixtureContractRecord.id,
      input: {
        fixture_reference: "REF-7",
        retired_field: "x",
        fixture_lines: {
          currency: "USD" as const,
          rows: [
            {
              sku: "SUPPORT",
              description: "",
              region: "",
              unit: "month",
              quantity: "12",
              termMonths: 1,
              unitPriceMinor: "100000",
              minimumQuantity: "0",
              discountBps: 0,
              extendedMinor: "1200000",
            },
          ],
        },
      },
    });
    mocks.contracts.get.mockResolvedValue({ contract: fixtureContractRecord });
  });

  it("starts from the earlier values, with the signer left out", async () => {
    const loaded = await loadPrepare("test-fixture", fixtureContractRecord.id);
    expect(loaded).toMatchObject({
      kind: "ready",
      start: {
        counterpartyName: fixtureContractRecord.counterpartyName,
        effectiveDate: fixtureContractRecord.effectiveDate,
        ownerName: fixtureContractRecord.ownerName,
        countersignerId: fixtureSigningRecord.countersigner.id,
        // Only the template's current fields, blank where none was kept.
        values: {
          fixture_reference: "REF-7",
          fixture_tier: "",
          fixture_note: "",
          // A line-item table is carried whole.
          fixture_lines: { currency: "USD", rows: [{ sku: "SUPPORT" }] },
        },
      },
    });
    expect(JSON.stringify(loaded)).not.toContain(
      fixtureSigningRecord.counterpartySigner.email,
    );
  });

  it("starts empty from another template, an unknown contract or a bad id", async () => {
    mocks.signing.get.mockResolvedValueOnce({
      ...fixtureSigningRecord,
      templateId: "customer-msa",
    });
    await expect(
      loadPrepare("test-fixture", fixtureContractRecord.id),
    ).resolves.toMatchObject({ kind: "ready", start: null });
    mocks.signing.get.mockRejectedValueOnce(
      new Error("CONTRACT_SIGNING_NOT_FOUND"),
    );
    await expect(
      loadPrepare("test-fixture", fixtureContractRecord.id),
    ).resolves.toMatchObject({ kind: "ready", start: null });
    await expect(loadPrepare("test-fixture", "../x")).resolves.toMatchObject({
      kind: "ready",
      start: null,
    });
    expect(mocks.signing.get).toHaveBeenCalledTimes(2);
  });
});

describe("recording a contract again", () => {
  it("starts from the record it replaces, and from nothing for an unknown or bad id", async () => {
    mocks.contracts.get.mockResolvedValueOnce({
      contract: fixtureContractRecord,
    });
    await expect(
      loadContractForm(undefined, undefined, fixtureContractRecord.id),
    ).resolves.toMatchObject({ kind: "ready", copyOf: fixtureContractRecord });
    mocks.contracts.get.mockRejectedValueOnce(new Error("CONTRACT_NOT_FOUND"));
    await expect(
      loadContractForm(undefined, undefined, fixtureContractRecord.id),
    ).resolves.toMatchObject({ kind: "ready", copyOf: null });
    await expect(
      loadContractForm(undefined, undefined, "../x"),
    ).resolves.toMatchObject({ kind: "ready", copyOf: null });
    expect(mocks.contracts.get).toHaveBeenCalledTimes(2);
  });
});

describe("counterparty paper sources", () => {
  const file = (kind: string) =>
    ({ id: kind, kind }) as unknown as Parameters<
      typeof counterpartyPaperSources
    >[0]["files"][number];
  const files = ["main", "counterparty_draft", "redline", "attachment"].map(
    file,
  );
  const open = {
    ...fixtureContractRecord,
    status: "in_negotiation" as const,
    executedAt: null,
  };

  it("offers the main PDF and drafts on an unsigned contract on either paper", () => {
    for (const paper of ["theirs", "ours"] as const)
      expect(
        counterpartyPaperSources({
          contract: { ...open, paper },
          files,
          signing: null,
        }).map((f) => f.kind),
      ).toEqual(["main", "counterparty_draft"]);
  });

  it("offers them again once the request ended without signatures", () => {
    for (const state of ["declined", "expired", "canceled"] as const)
      expect(
        counterpartyPaperSources({
          contract: open,
          files,
          signing: { ...fixtureSigningRecord, state },
        }),
      ).toHaveLength(2);
  });

  it("offers nothing once executed, or while a request is open or completed", () => {
    for (const detail of [
      {
        contract: { ...open, status: "executed" as const },
        files,
        signing: null,
      },
      { contract: open, files, signing: fixtureSigningRecord },
      {
        contract: open,
        files,
        signing: { ...fixtureSigningRecord, state: "completed" as const },
      },
    ])
      expect(counterpartyPaperSources(detail)).toEqual([]);
  });
});
