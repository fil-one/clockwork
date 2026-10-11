import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { fixtureRecord as mndaFixture } from "../../../../../packages/contracts/src/mnda-fixture";

import type { McpToolContext } from "./tool";

const mocks = vi.hoisted(() => ({
  loadNotificationInbox: vi.fn(),
  loadOlderNotifications: vi.fn(),
  loadMndas: vi.fn(),
  prepareMnda: vi.fn(),
  readMnda: vi.fn(),
  loadContract: vi.fn(),
  operateContract: vi.fn(),
  saveContract: vi.fn(),
  addFile: vi.fn(),
  prepareCounterpartyPaper: vi.fn(),
}));

vi.mock("@/src/features/internal-ops/notifications/page-data", () => ({
  loadNotificationInbox: mocks.loadNotificationInbox,
}));
vi.mock("@/src/features/internal-ops/notifications/actions", () => ({
  loadOlderNotifications: mocks.loadOlderNotifications,
  markAllNotificationsRead: vi.fn(),
  markNotificationsRead: vi.fn(),
}));
vi.mock("@/src/features/internal-ops/mnda/actions", () => ({
  loadMndas: mocks.loadMndas,
  prepareMnda: mocks.prepareMnda,
  findMndaDuplicates: vi.fn(),
  operateMnda: vi.fn(),
}));
vi.mock("@/src/features/internal-ops/mnda/server", () => ({
  mndaActor: vi.fn(),
  mndaRepository: () => ({ get: mocks.readMnda }),
  mndaStaff: vi.fn(),
}));
vi.mock("@/src/features/internal-ops/contracts/actions", () => ({
  operateContract: mocks.operateContract,
  saveContract: mocks.saveContract,
  prepareCounterpartyPaper: mocks.prepareCounterpartyPaper,
  prepareContract: vi.fn(),
}));
vi.mock("@/src/features/internal-ops/contracts/loaders", () => ({
  loadContract: mocks.loadContract,
  loadPrepare: vi.fn(),
  loadRegister: vi.fn(),
  loadRenewals: vi.fn(),
  loadTemplates: vi.fn(),
}));
vi.mock("@/src/features/internal-ops/contracts/server", () => ({
  contractStaff: () =>
    Promise.resolve({
      userId: "20000000-0000-4000-8000-000000000001",
      profile: { name: "Seller" },
    }),
  contractActor: () => ({ kind: "user", id: "seller" }),
  contractRepository: () => ({ addFile: mocks.addFile }),
}));
vi.mock("@/src/features/internal-ops/contracts/http", () => ({
  withDocumentSlot: (run: () => Promise<unknown>) => run(),
}));

const { listNotifications } = await import("./tools/notifications");
const { createMndaDraft, listMndas, getMnda, prepareMndaPreview } =
  await import("./tools/mndas");
const { prepareContractForSignature, recordContract, checkContractStatus } =
  await import("./tools/contracts");

const contractId = "30000000-0000-4000-8000-000000000001";
const signerId = "30000000-0000-4000-8000-000000000002";
const unavailableSignerId = "30000000-0000-4000-8000-000000000003";
const context = () =>
  ({
    origin: "https://commerce.fil.one",
    targets: {},
  }) as McpToolContext;

beforeEach(() => vi.resetAllMocks());

describe("MCP workflow boundaries", () => {
  it("exposes active countersigner IDs for an MNDA draft without exposing inactive choices", async () => {
    mocks.loadMndas.mockResolvedValue({
      ok: true,
      value: {
        register: { total: 0, page: 1, pageSize: 25, records: [] },
        signers: [
          {
            id: signerId,
            name: "Signer",
            title: "Director",
            active: true,
            isDefault: true,
            email: "signer@example.test",
          },
          {
            id: unavailableSignerId,
            name: "Retired signer",
            active: false,
            isDefault: false,
          },
        ],
      },
    });
    const result = await listMndas.run({}, context());
    expect(result).toMatchObject({
      countersigners: [
        { id: signerId, name: "Signer", title: "Director", isDefault: true },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(unavailableSignerId);
    expect(JSON.stringify(result)).not.toContain("signer@example.test");
  });

  it.each([getMnda, prepareMndaPreview])(
    "returns saved draft detail through $name before revising",
    async (tool) => {
      const record = {
        ...mndaFixture,
        input: {
          ...mndaFixture.input,
          shortName: "Acme",
          entityDescription: "a Delaware corporation",
          streetAddress: "1 Main Street",
          locality: "Wilmington, DE",
          noticesContact: "Legal department",
          noticesEmail: "notices@acme.example",
        },
      };
      mocks.readMnda.mockResolvedValue(record);
      const result = await tool.run({ id: record.id }, context());
      const detail =
        tool.name === "get_mnda" ? result : (result as { mnda: unknown }).mnda;
      expect(detail).toMatchObject({
        details: {
          detailsMode: record.input.detailsMode,
          shortName: "Acme",
          entityDescription: "a Delaware corporation",
          streetAddress: "1 Main Street",
          locality: "Wilmington, DE",
          noticesContact: "Legal department",
          noticesEmail: "notices@acme.example",
          countersignerId: record.countersigner.id,
        },
      });
      expect(mocks.prepareMnda).not.toHaveBeenCalled();
    },
  );

  it("requires an explicit signing request number for a contract refresh", () => {
    expect(
      z.object(checkContractStatus.input).safeParse({ contractId }).success,
    ).toBe(false);
  });

  it("refuses refresh after the signing request has been replaced", async () => {
    mocks.loadContract.mockResolvedValue({
      kind: "ready",
      signing: { requestNumber: 2 },
    });
    await expect(
      checkContractStatus.run({ contractId, requestNumber: 1 }, context()),
    ).rejects.toMatchObject({ code: "CONTRACT_REQUEST_CHANGED" });
    expect(mocks.operateContract).not.toHaveBeenCalled();
  });

  it("refuses refresh when the contract has no signing request", async () => {
    mocks.loadContract.mockResolvedValue({ kind: "ready", signing: null });
    await expect(
      checkContractStatus.run({ contractId, requestNumber: 1 }, context()),
    ).rejects.toMatchObject({ code: "CONTRACT_SIGNING_NOT_FOUND" });
    expect(mocks.operateContract).not.toHaveBeenCalled();
  });

  it("passes the exact request number and only sync to the existing contract action", async () => {
    mocks.loadContract.mockResolvedValue({
      kind: "ready",
      signing: { requestNumber: 3 },
    });
    mocks.operateContract.mockResolvedValue({
      ok: false,
      code: "STOP_AFTER_SYNC",
    });
    await expect(
      checkContractStatus.run({ contractId, requestNumber: 3 }, context()),
    ).rejects.toMatchObject({ code: "STOP_AFTER_SYNC" });
    expect(mocks.operateContract).toHaveBeenCalledExactlyOnceWith({
      contractId,
      requestNumber: 3,
      operation: "sync",
    });
  });
  it("returns a usable cursor when an unread-only page contains only read notifications", async () => {
    const read = {
      id: "40000000-0000-4000-8000-000000000001",
      createdAt: "2026-10-11T12:00:00.000Z",
      readAt: "2026-10-11T12:01:00.000Z",
    };
    mocks.loadNotificationInbox.mockResolvedValue({
      kind: "ready",
      value: { page: { unread: 1, more: true, notifications: [read] } },
    });
    const first = (await listNotifications.run(
      { unreadOnly: true },
      context(),
    )) as { notifications: unknown[]; nextCursor: unknown };
    expect(first.notifications).toEqual([]);
    expect(first.nextCursor).toEqual({
      id: read.id,
      createdAt: read.createdAt,
    });

    mocks.loadOlderNotifications.mockResolvedValue({
      ok: true,
      value: {
        unread: 1,
        more: false,
        notifications: [{ ...read, readAt: null, href: "/internal/mndas" }],
      },
    });
    const next = (await listNotifications.run(
      { unreadOnly: true, before: first.nextCursor },
      context(),
    )) as { notifications: unknown[]; nextCursor: unknown };
    expect(mocks.loadOlderNotifications).toHaveBeenCalledWith(first.nextCursor);
    expect(next.notifications).toHaveLength(1);
    expect(next.nextCursor).toBeNull();
  });

  it("refuses an explicitly unavailable MNDA countersigner instead of substituting the default", async () => {
    mocks.loadMndas.mockResolvedValue({
      ok: true,
      value: {
        signers: [{ id: signerId, active: true, isDefault: true }],
      },
    });
    await expect(
      createMndaDraft.run(
        {
          company: "Acme",
          signerName: "Buyer",
          signerEmail: "buyer@example.com",
          countersignerId: unavailableSignerId,
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: "countersigner_unavailable" });
    expect(mocks.prepareMnda).not.toHaveBeenCalled();
  });

  it("passes a caller-selected MNDA id through to the repository's idempotent create", async () => {
    mocks.loadMndas.mockResolvedValue({
      ok: true,
      value: { signers: [{ id: signerId, active: true, isDefault: true }] },
    });
    mocks.prepareMnda.mockResolvedValue({
      ok: false,
      code: "STOP_AFTER_PREPARE",
    });
    const args = {
      id: contractId,
      company: "Acme",
      signerName: "Buyer",
      signerEmail: "buyer@example.com",
      effectiveDate: "2026-10-11",
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(createMndaDraft.run(args, context())).rejects.toMatchObject({
        code: "STOP_AFTER_PREPARE",
      });
    }
    expect(mocks.prepareMnda).toHaveBeenCalledTimes(2);
    expect(mocks.prepareMnda.mock.calls[0]).toEqual(
      mocks.prepareMnda.mock.calls[1],
    );
    expect(mocks.prepareMnda.mock.calls[0]?.[0]).toMatchObject({
      input: { id: contractId },
    });
  });

  it("refuses an explicitly unavailable contract countersigner instead of substituting the first", async () => {
    mocks.loadContract.mockResolvedValue({
      kind: "ready",
      paperSources: [{ id: contractId, fileName: "agreement.pdf" }],
      countersigners: [{ id: signerId }],
    });
    await expect(
      prepareContractForSignature.run(
        {
          contractId,
          signers: "fil-one",
          countersignerId: unavailableSignerId,
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: "CONTRACT_COUNTERSIGNER_UNAVAILABLE" });
    expect(mocks.prepareCounterpartyPaper).not.toHaveBeenCalled();
  });

  it.each([undefined, signerId])(
    "preserves default and explicitly selected countersigners (%s)",
    async (countersignerId) => {
      mocks.loadMndas.mockResolvedValue({
        ok: true,
        value: { signers: [{ id: signerId, active: true, isDefault: true }] },
      });
      mocks.prepareMnda.mockResolvedValue({
        ok: false,
        code: "STOP_AFTER_PREPARE",
      });
      await expect(
        createMndaDraft.run(
          {
            company: "Acme",
            signerName: "Buyer",
            signerEmail: "buyer@example.com",
            countersignerId,
          },
          context(),
        ),
      ).rejects.toMatchObject({ code: "STOP_AFTER_PREPARE" });
      expect(mocks.prepareMnda.mock.calls[0]?.[0]).toMatchObject({
        input: { countersignerId: signerId },
      });

      mocks.loadContract.mockResolvedValue({
        kind: "ready",
        paperSources: [{ id: contractId, fileName: "agreement.pdf" }],
        countersigners: [{ id: signerId }],
      });
      mocks.prepareCounterpartyPaper.mockResolvedValue({
        ok: false,
        code: "STOP_AFTER_PREPARE",
      });
      await expect(
        prepareContractForSignature.run(
          { contractId, signers: "fil-one", countersignerId },
          context(),
        ),
      ).rejects.toMatchObject({ code: "STOP_AFTER_PREPARE" });
      expect(mocks.prepareCounterpartyPaper).toHaveBeenCalledWith(
        expect.objectContaining({ countersignerId: signerId }),
      );
    },
  );

  it("uses opt-in attachment deduplication when retrying a contract upload", async () => {
    mocks.loadContract.mockResolvedValue({
      kind: "ready",
      contract: { id: contractId },
      files: [],
      signing: null,
      previousSigning: [],
      paperSources: [],
    });
    const args = {
      id: contractId,
      files: [
        {
          fileName: "agreement.pdf",
          base64: Buffer.from("%PDF-1.7\n%%EOF").toString("base64"),
        },
      ],
    };
    await recordContract.run(args, context());
    await recordContract.run(args, context());
    expect(mocks.addFile).toHaveBeenCalledTimes(2);
    expect(mocks.addFile).toHaveBeenLastCalledWith(
      contractId,
      expect.objectContaining({ kind: "main", fileName: "agreement.pdf" }),
      expect.any(Object),
      { deduplicate: true },
    );
    expect(mocks.saveContract).not.toHaveBeenCalled();
  });

  it("rejects invalid PDF bytes before saving contract metadata", async () => {
    mocks.saveContract.mockResolvedValue({
      ok: true,
      value: { id: contractId },
    });
    await expect(
      recordContract.run(
        {
          counterpartyName: "Acme",
          files: [
            {
              fileName: "agreement.pdf",
              base64: Buffer.from("not a PDF").toString("base64"),
            },
          ],
        },
        context(),
      ),
    ).rejects.toThrow("DOCUMENT_NOT_PDF");
    expect(mocks.saveContract).not.toHaveBeenCalled();
    expect(mocks.addFile).not.toHaveBeenCalled();
  });
});
