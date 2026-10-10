import type * as Server from "./server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureContractInput } from "../../../../../../packages/contracts/src/contract-fixture";
import { fixtureContractTemplateRegistry } from "../../../../../../packages/documents/src/__fixtures__/contract-template";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  repository: {
    create: vi.fn(),
    update: vi.fn(),
    removeFile: vi.fn(),
  },
  signing: {
    countersigners: vi.fn(),
    prepare: vi.fn(),
    decide: vi.fn(),
    get: vi.fn(),
  },
  workflow: {
    send: vi.fn(),
    sync: vi.fn(),
    remind: vi.fn(),
    cancel: vi.fn(),
    void: vi.fn(),
  },
  library: { create: vi.fn(), update: vi.fn() },
  registry: vi.fn(),
  mnda: { duplicates: vi.fn(), contractDuplicates: vi.fn() },
}));
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.session,
  explicitDemoIdentityEnabled: () => false,
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: vi.fn() }));
vi.mock("./server", async (original) => ({
  ...(await original<typeof Server>()),
  contractRepository: () => mocks.repository,
  contractSigningRepository: () => mocks.signing,
  contractSigningWorkflow: () => mocks.workflow,
  salesLibraryRepository: () => mocks.library,
  contractTemplateRegistry: mocks.registry,
}));
vi.mock("../mnda/server", () => ({ mndaRepository: () => mocks.mnda }));
import {
  decideContract,
  findContractDuplicates,
  operateContract,
  prepareContract,
  removeContractFile,
  saveContract,
  voidContract,
} from "./actions";
import { saveCollateral } from "../sales-library/actions";

const as = (role: string, patch: Record<string, unknown> = {}) =>
  mocks.session.mockResolvedValue({
    userId: "019a44ac-0000-7000-8000-0000000000aa",
    profile: { name: "Seller", email: "seller@fil.one" },
    roles: [role],
    isInternalStaff: true,
    mfaVerified: true,
    ...patch,
  });
const contractId = "019a44ac-0000-7000-8000-0000000000c1";
const countersigner = {
  id: "019a44ac-0000-7000-8000-000000000001",
  name: "James Kurz",
  email: "james@fil.one",
  title: "CFO/CSO",
  isDefault: true,
};
const prepareInput = (patch: Record<string, unknown> = {}) => ({
  id: "019a44ac-0000-7000-8000-0000000000c9",
  templateId: "test-fixture",
  counterpartyName: "Bluefin Data Co.",
  effectiveDate: "2026-10-05",
  signerName: "Alex Example",
  signerEmail: "alex@example.com",
  signerTitle: "CEO",
  countersignerId: countersigner.id,
  ownerName: "Seller",
  values: { fixture_reference: "REF-7", fixture_tier: "beta" },
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.registry.mockReturnValue(fixtureContractTemplateRegistry);
  mocks.signing.countersigners.mockResolvedValue([countersigner]);
  mocks.signing.prepare.mockResolvedValue({ duplicate: false });
  mocks.signing.decide.mockResolvedValue({ approvalState: "approved" });
  mocks.workflow.send.mockResolvedValue({ state: "sent" });
  mocks.repository.update.mockResolvedValue(3);
});

describe("server action authorization", () => {
  it.each([
    [
      "finance_approver",
      () => saveContract({ contract: fixtureContractInput }),
    ],
    [
      "finance_approver",
      () => removeContractFile({ contractId, fileId: contractId }),
    ],
    ["finance_approver", () => prepareContract(prepareInput())],
    [
      "finance_approver",
      () => operateContract({ contractId, operation: "send" }),
    ],
    ["revenue", () => decideContract({ contractId, approve: true })],
    [
      "finance_approver",
      () => voidContract({ contractId, reason: "Wrong legal entity" }),
    ],
    ["revenue", () => saveCollateral({ item: {} })],
    ["owner", () => saveContract({ contract: fixtureContractInput })],
  ])("%s is refused", async (role, action) => {
    as(role, role === "owner" ? { isInternalStaff: false } : {});
    await expect(action()).resolves.toEqual({
      ok: false,
      code: "CONTRACT_FORBIDDEN",
    });
    for (const fn of [
      ...Object.values(mocks.repository),
      ...Object.values(mocks.signing),
      ...Object.values(mocks.workflow),
      ...Object.values(mocks.library),
    ])
      expect(fn).not.toHaveBeenCalled();
  });

  it("refuses every action without a verified second factor", async () => {
    as("commerce_admin", { mfaVerified: false });
    await expect(
      saveContract({ contract: fixtureContractInput }),
    ).resolves.toMatchObject({ code: "CONTRACT_MFA_REQUIRED" });
  });
});

describe("saveContract", () => {
  it("records a new contract, or edits against the version the seller saw", async () => {
    as("revenue");
    await expect(
      saveContract({ contract: fixtureContractInput }),
    ).resolves.toEqual({ ok: true, value: { id: contractId, version: 1 } });
    expect(mocks.repository.create).toHaveBeenCalledOnce();
    await expect(
      saveContract({ contract: fixtureContractInput, expectedVersion: 2 }),
    ).resolves.toEqual({ ok: true, value: { id: contractId, version: 3 } });
    expect(mocks.repository.update).toHaveBeenCalledWith(
      contractId,
      2,
      expect.objectContaining({ counterpartyName: "Bluefin Data Co." }),
      expect.objectContaining({ kind: "user", display: "Seller" }),
    );
  });

  it("returns field problems instead of throwing", async () => {
    as("revenue");
    await expect(
      saveContract({
        contract: { ...fixtureContractInput, counterpartyName: " " },
      }),
    ).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      fields: { counterpartyName: "too_small" },
    });
    await expect(
      saveContract({ contract: { ...fixtureContractInput, currency: null } }),
    ).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      fields: { currency: "value_and_currency" },
    });
  });

  it("passes coded repository failures through and hides everything else", async () => {
    as("revenue");
    mocks.repository.update.mockRejectedValueOnce(
      new Error("CONTRACT_VERSION_CONFLICT"),
    );
    await expect(
      saveContract({ contract: fixtureContractInput, expectedVersion: 1 }),
    ).resolves.toEqual({ ok: false, code: "CONTRACT_VERSION_CONFLICT" });
    mocks.repository.update.mockRejectedValueOnce(
      new Error('duplicate key value violates "secret_index"'),
    );
    await expect(
      saveContract({ contract: fixtureContractInput, expectedVersion: 1 }),
    ).resolves.toEqual({ ok: false, code: "UNEXPECTED" });
  });
});

describe("findContractDuplicates", () => {
  const mndaMatch = {
    id: "019a44ac-0000-7000-8000-0000000000e1",
    company: "Bluefin Data Co.",
    state: "completed",
    createdAt: "2026-09-01T00:00:00.000Z",
    completedAt: "2026-09-02T00:00:00.000Z",
    ownerName: "Seller",
  };
  const contractMatch = {
    id: contractId,
    counterpartyName: "BLUEFIN DATA, Inc.",
    contractType: "order_form",
    status: "executed",
    effectiveDate: "2026-03-01",
    ownerName: "Morgan Lee",
  };
  beforeEach(() => {
    mocks.mnda.duplicates.mockResolvedValue([mndaMatch]);
    mocks.mnda.contractDuplicates.mockResolvedValue([contractMatch]);
  });

  it("runs the MNDA register's check for the counterparty being recorded", async () => {
    as("revenue");
    await expect(
      findContractDuplicates({
        counterpartyName: " Bluefin Data Co ",
        excludeMndaId: mndaMatch.id,
      }),
    ).resolves.toEqual({
      ok: true,
      value: { mndas: [mndaMatch], contracts: [contractMatch] },
    });
    expect(mocks.mnda.duplicates).toHaveBeenCalledWith(
      "Bluefin Data Co",
      mndaMatch.id,
    );
    expect(mocks.mnda.contractDuplicates).toHaveBeenCalledWith(
      "Bluefin Data Co",
    );
    // A warning only: nothing is written.
    expect(mocks.repository.create).not.toHaveBeenCalled();
  });

  it("lists MNDAs only to people who may open the MNDA register", async () => {
    as("revenue", { permissions: ["contract:read", "contract:write"] });
    await expect(
      findContractDuplicates({ counterpartyName: "Bluefin" }),
    ).resolves.toEqual({
      ok: true,
      value: { mndas: [], contracts: [contractMatch] },
    });
    expect(mocks.mnda.duplicates).not.toHaveBeenCalled();
  });

  it("refuses a reader who cannot record contracts", async () => {
    as("finance_approver");
    await expect(
      findContractDuplicates({ counterpartyName: "Bluefin" }),
    ).resolves.toEqual({ ok: false, code: "CONTRACT_FORBIDDEN" });
    expect(mocks.mnda.contractDuplicates).not.toHaveBeenCalled();
  });
});

describe("prepareContract", () => {
  it("renders the template and records a draft that needs approval", async () => {
    as("revenue");
    await expect(prepareContract(prepareInput())).resolves.toEqual({
      ok: true,
      value: { id: "019a44ac-0000-7000-8000-0000000000c9" },
    });
    const [prepared] = mocks.signing.prepare.mock.calls[0] as [
      {
        contract: { status: string; paper: string; contractType: string };
        signing: { approvalRequired: boolean; documentName: string };
        pdf: Uint8Array;
      },
    ];
    expect(prepared.contract).toMatchObject({
      status: "draft",
      paper: "ours",
      contractType: "other",
    });
    expect(prepared.signing).toMatchObject({
      approvalRequired: true,
      documentName: "Fil One Engine Test Fixture - Bluefin Data Co.",
    });
    expect(Buffer.from(prepared.pdf.subarray(0, 5)).toString()).toBe("%PDF-");
  }, 30_000);

  it("refuses templates pending from legal", async () => {
    as("revenue");
    await expect(
      prepareContract(prepareInput({ templateId: "channel-partnership" })),
    ).resolves.toEqual({ ok: false, code: "CONTRACT_TEMPLATE_PENDING_LEGAL" });
    expect(mocks.signing.prepare).not.toHaveBeenCalled();
  });

  it("validates template fields and signer rules", async () => {
    as("revenue");
    await expect(
      prepareContract(prepareInput({ values: { fixture_reference: "" } })),
    ).resolves.toMatchObject({
      code: "INVALID_INPUT",
      fields: {
        "values.fixture_reference": "required",
        "values.fixture_tier": "required",
      },
    });
    await expect(
      prepareContract(prepareInput({ signerEmail: "JAMES@fil.one" })),
    ).resolves.toEqual({
      ok: false,
      code: "CONTRACT_DISTINCT_SIGNERS_REQUIRED",
    });
    await expect(
      prepareContract(
        prepareInput({
          values: { fixture_reference: "{{x}}", fixture_tier: "beta" },
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      code: "CONTRACT_TEMPLATE_VALUE_CHARACTERS",
    });
  });
});

describe("decideContract and operateContract", () => {
  it("lets an approver decide and requires a reason to send back", async () => {
    as("finance_approver");
    await expect(
      decideContract({ contractId, approve: true }),
    ).resolves.toEqual({ ok: true, value: { approvalState: "approved" } });
    await expect(
      decideContract({ contractId, approve: false, reason: "  " }),
    ).resolves.toMatchObject({ code: "INVALID_INPUT" });
    expect(mocks.signing.decide).toHaveBeenCalledOnce();
  });

  it("runs only known operations", async () => {
    as("revenue");
    await expect(
      operateContract({ contractId, operation: "send" }),
    ).resolves.toEqual({ ok: true, value: { state: "sent" } });
    await expect(
      operateContract({ contractId, operation: "delete" }),
    ).resolves.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("voidContract", () => {
  it("lets the preparer void with a reason", async () => {
    as("revenue");
    mocks.signing.get.mockResolvedValue({
      preparerId: "019a44ac-0000-7000-8000-0000000000aa",
    });
    mocks.workflow.void.mockResolvedValue({ state: "canceled" });
    await expect(
      voidContract({ contractId, reason: "  Wrong legal entity " }),
    ).resolves.toEqual({ ok: true, value: { state: "canceled" } });
    expect(mocks.workflow.void).toHaveBeenCalledWith(
      contractId,
      expect.objectContaining({ id: "019a44ac-0000-7000-8000-0000000000aa" }),
      "Wrong legal entity",
    );
  });

  it("needs an approver to void a colleague's request", async () => {
    as("revenue");
    mocks.signing.get.mockResolvedValue({
      preparerId: "019a44ac-0000-7000-8000-0000000000bb",
    });
    await expect(
      voidContract({ contractId, reason: "Wrong legal entity" }),
    ).resolves.toEqual({ ok: false, code: "CONTRACT_NOT_PREPARER" });
    as("legal_approver");
    mocks.workflow.void.mockResolvedValue({ state: "canceled" });
    await expect(
      voidContract({ contractId, reason: "Wrong legal entity" }),
    ).resolves.toEqual({ ok: true, value: { state: "canceled" } });
    expect(mocks.workflow.void).toHaveBeenCalledOnce();
  });

  it("requires a reason", async () => {
    as("commerce_admin");
    await expect(
      voidContract({ contractId, reason: " " }),
    ).resolves.toMatchObject({ code: "INVALID_INPUT" });
    expect(mocks.workflow.void).not.toHaveBeenCalled();
  });
});

describe("saveCollateral", () => {
  it("lets a collateral manager add a link", async () => {
    as("commerce_admin");
    mocks.library.create.mockResolvedValue({ id: "x" });
    const item = {
      id: "019a44ac-0000-7000-8000-0000000000e1",
      title: "Overview deck",
      kind: "pitch_deck",
      audience: "customer",
      status: "current",
      contentUpdatedOn: "2026-10-01",
      linkUrl: "https://example.com/deck",
    };
    await expect(saveCollateral({ item })).resolves.toMatchObject({ ok: true });
    await expect(
      saveCollateral({ item: { ...item, linkUrl: "javascript:alert(1)" } }),
    ).resolves.toMatchObject({ code: "INVALID_INPUT" });
  });
});
