import type * as Documents from "@clockwork/documents";
import type * as Server from "./server";
import type * as ScenarioServer from "../sales-pricing/scenario-server";
import type * as LineItemsServer from "./line-items-server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureContractInput } from "../../../../../../packages/contracts/src/contract-fixture";
import { fixtureContractTemplateRegistry } from "../../../../../../packages/documents/src/__fixtures__/contract-template";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  repository: {
    create: vi.fn(),
    update: vi.fn(),
    removeFile: vi.fn(),
    readFile: vi.fn(),
  },
  signing: {
    countersigners: vi.fn(),
    prepare: vi.fn(),
    prepareCounterpartyPaper: vi.fn(),
    resend: vi.fn(),
    decide: vi.fn(),
    get: vi.fn(),
  },
  workflow: {
    send: vi.fn(),
    sync: vi.fn(),
    remind: vi.fn(),
    cancel: vi.fn(),
    void: vi.fn(),
    correctSigner: vi.fn(),
  },
  library: { create: vi.fn(), update: vi.fn() },
  registry: vi.fn(),
  mnda: { duplicates: vi.fn(), contractDuplicates: vi.fn() },
  scenarios: { get: vi.fn() },
  minimums: vi.fn(),
  renderPaper: vi.fn(),
}));
vi.mock("@clockwork/documents", async (original) => ({
  ...(await original<typeof Documents>()),
  renderCounterpartyPaper: mocks.renderPaper,
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
vi.mock("../sales-pricing/scenario-server", async (original) => ({
  ...(await original<typeof ScenarioServer>()),
  scenarioRepository: () => mocks.scenarios,
}));
vi.mock("./line-items-server", async (original) => ({
  ...(await original<typeof LineItemsServer>()),
  templateRateMinimums: mocks.minimums,
}));
import { rateMinimums } from "./line-items";
import {
  correctContractSigner,
  decideContract,
  findContractDuplicates,
  operateContract,
  prepareContract,
  prepareCounterpartyPaper,
  removeContractFile,
  resendContract,
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
  values: {
    fixture_reference: "REF-7",
    fixture_tier: "beta",
    fixture_lines: lineItems(),
  },
  ...patch,
});
function lineItems(
  row: Record<string, unknown> = {},
  scenario?: Record<string, unknown>,
) {
  return {
    currency: "USD",
    ...(scenario ? { scenario } : {}),
    rows: [
      {
        sku: "STORAGE-TB",
        region: "us-east",
        unit: "TB-month",
        quantity: "500",
        termMonths: 12,
        unitPriceMinor: "1500",
        minimumQuantity: "10",
        discountBps: 1000,
        extendedMinor: "8100000",
        ...row,
      },
    ],
  };
}
// The in-force rate the fixture row matches.
const storageRate = {
  sku: "STORAGE-TB",
  region: "us-east",
  unit: "TB-month",
  minimumQuantity: "10.000000000000000000",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.registry.mockReturnValue(fixtureContractTemplateRegistry);
  mocks.signing.countersigners.mockResolvedValue([countersigner]);
  mocks.signing.prepare.mockResolvedValue({ duplicate: false });
  mocks.signing.decide.mockResolvedValue({ approvalState: "approved" });
  mocks.workflow.send.mockResolvedValue({ state: "sent" });
  mocks.repository.update.mockResolvedValue(3);
  mocks.minimums.mockResolvedValue(
    rateMinimums([{ rateCards: [storageRate] }]),
  );
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
          values: {
            fixture_reference: "{{x}}",
            fixture_tier: "beta",
            fixture_lines: lineItems(),
          },
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      code: "CONTRACT_TEMPLATE_VALUE_CHARACTERS",
    });
  });

  it("checks a line-item table by the pricing scenario rules", async () => {
    as("revenue");
    const withLines = (fixture_lines: unknown) =>
      prepareContract(
        prepareInput({
          values: {
            fixture_reference: "REF-7",
            fixture_tier: "beta",
            fixture_lines,
          },
        }),
      );
    for (const [lines, code] of [
      [null, "required"],
      [{ currency: "USD", rows: [] }, "required"],
      [lineItems({ quantity: "5", extendedMinor: "81000" }), "below_minimum"],
      [lineItems({ extendedMinor: "8100001" }), "line_total"],
      [lineItems({ sku: "<b>" }), "characters"],
      [lineItems({ termMonths: 0 }), "line_items"],
      [{ ...lineItems(), currency: "JPY" }, "line_items"],
    ] as const)
      await expect(withLines(lines)).resolves.toEqual({
        ok: false,
        code: "INVALID_INPUT",
        fields: { "values.fixture_lines": code },
      });
    expect(mocks.signing.prepare).not.toHaveBeenCalled();
  });

  it("applies the in-force rate's minimum whatever minimum the browser sends", async () => {
    as("revenue");
    const withRow = (row: Record<string, unknown>) =>
      prepareContract(
        prepareInput({
          values: {
            fixture_reference: "REF-7",
            fixture_tier: "beta",
            fixture_lines: lineItems(row),
          },
        }),
      );
    // A row typed by hand sends "0"; the matching rate's minimum is 10.
    await expect(
      withRow({ quantity: "5", minimumQuantity: "0", extendedMinor: "81000" }),
    ).resolves.toMatchObject({
      fields: { "values.fixture_lines": "below_minimum" },
    });
    expect(mocks.signing.prepare).not.toHaveBeenCalled();
    // A row that matches no rate has no minimum, whatever it sends.
    await expect(
      withRow({
        sku: "ONBOARDING",
        quantity: "5",
        minimumQuantity: "50",
        extendedMinor: "81000",
      }),
    ).resolves.toMatchObject({ ok: true });
    const [prepared] = mocks.signing.prepare.mock.calls[0] as [
      { signing: { input: { fixture_lines: { rows: unknown[] } } } },
    ];
    expect(prepared.signing.input.fixture_lines.rows[0]).toMatchObject({
      sku: "ONBOARDING",
      minimumQuantity: "0",
    });
  }, 30_000);
});

describe("pricing notes for an imported scenario", () => {
  const scenarioId = "019a44ac-0000-7000-8000-00000000ab01";
  const link = {
    id: scenarioId,
    name: "Acme Q4",
    version: 2,
    asOf: "2026-10-09",
  };
  const scenario = {
    id: scenarioId,
    name: "Acme Q4",
    version: 2,
    asOf: "2026-10-09",
    lines: [
      {
        sku: "STORAGE-TB",
        region: "us-east",
        unit: "TB-month",
        unitPrice: { currency: "USD", minor: "1500" },
        minimumQuantity: "10.000000000000000000",
        quantity: "500",
        termMonths: 12,
        discountBps: 1000,
      },
    ],
  };
  const note = async (fixture_lines: unknown) => {
    await expect(
      prepareContract(
        prepareInput({
          values: {
            fixture_reference: "REF-7",
            fixture_tier: "beta",
            fixture_lines,
          },
        }),
      ),
    ).resolves.toMatchObject({ ok: true });
    const [prepared] = mocks.signing.prepare.mock.calls.at(-1) as [
      { contract: { pricingNotes: string } },
    ];
    return prepared.contract.pricingNotes;
  };

  beforeEach(() => {
    as("revenue");
    mocks.scenarios.get.mockResolvedValue(scenario);
  });

  it("vouches for list prices only when every row still matches the scenario", async () => {
    await expect(note(lineItems({ scenarioLine: 0 }, link))).resolves.toBe(
      `Line items imported from pricing scenario "Acme Q4" (${scenarioId}) version 2, list prices as of 2026-10-09.`,
    );
    expect(mocks.scenarios.get).toHaveBeenCalledWith(scenarioId, {
      kind: "own",
      ownerId: "019a44ac-0000-7000-8000-0000000000aa",
    });
    // A different quantity is the seller's entry, not a price.
    await expect(
      note(
        lineItems(
          { scenarioLine: 0, quantity: "600", extendedMinor: "9720000" },
          link,
        ),
      ),
    ).resolves.toContain("list prices as of 2026-10-09.");
  }, 30_000);

  it("names the lines edited after import and never vouches for them", async () => {
    // The unit price was changed after import.
    await expect(
      note(
        lineItems(
          { scenarioLine: 0, unitPriceMinor: "1400", extendedMinor: "7560000" },
          link,
        ),
      ),
    ).resolves.toBe(
      `Line items imported from pricing scenario "Acme Q4" (${scenarioId}) version 2, then edited (line 1).`,
    );
    // A row typed in by hand carries no scenario link.
    await expect(note(lineItems({}, link))).resolves.toContain(
      "then edited (line 1).",
    );
    // The scenario was saved again after import.
    mocks.scenarios.get.mockResolvedValue({ ...scenario, version: 3 });
    await expect(note(lineItems({ scenarioLine: 0 }, link))).resolves.toBe(
      `Line items imported from pricing scenario "Acme Q4" (${scenarioId}) version 2; the scenario has changed since, so its prices were not checked against these lines.`,
    );
  }, 30_000);

  it("writes no note for a detached table and refuses a scenario out of reach", async () => {
    await expect(note(lineItems())).resolves.toBe("");
    expect(mocks.scenarios.get).not.toHaveBeenCalled();
    mocks.scenarios.get.mockRejectedValue(
      new Error("PRICING_SCENARIO_NOT_FOUND"),
    );
    await expect(
      prepareContract(
        prepareInput({
          values: {
            fixture_reference: "REF-7",
            fixture_tier: "beta",
            fixture_lines: lineItems({ scenarioLine: 0 }, link),
          },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: "PRICING_SCENARIO_NOT_FOUND" });
    expect(mocks.signing.prepare).toHaveBeenCalledTimes(1);
  }, 30_000);
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

  it("lets a holder of approval:self approve their own contract with a reason", async () => {
    const reason = "Two-person team, colleague travelling";
    as("commerce_admin", { recentAuthenticationVerified: true });
    await expect(
      decideContract({ contractId, approve: true, selfApprovalReason: reason }),
    ).resolves.toEqual({ ok: true, value: { approvalState: "approved" } });
    expect(mocks.signing.decide).toHaveBeenCalledWith(
      contractId,
      { approve: true, selfApproval: { reason } },
      expect.objectContaining({ id: "019a44ac-0000-7000-8000-0000000000aa" }),
      undefined,
    );
  });

  it("refuses a self-approval without approval:self, from a provider impersonation, or without recent sign-in", async () => {
    const reason = "Two-person team, colleague travelling";
    const selfApprove = () =>
      decideContract({ contractId, approve: true, selfApprovalReason: reason });
    as("finance_approver", { recentAuthenticationVerified: true });
    await expect(selfApprove()).resolves.toMatchObject({
      code: "SELF_APPROVAL_NOT_PERMITTED",
    });
    as("commerce_admin", {
      recentAuthenticationVerified: true,
      authenticationProviderImpersonator: true,
    });
    await expect(selfApprove()).resolves.toMatchObject({
      code: "SELF_APPROVAL_NOT_PERMITTED",
    });
    as("commerce_admin", { recentAuthenticationVerified: false });
    await expect(selfApprove()).resolves.toMatchObject({
      code: "CONTRACT_RECENT_AUTH_REQUIRED",
    });
    await expect(
      decideContract({
        contractId,
        approve: false,
        reason: "Discount",
        selfApprovalReason: reason,
      }),
    ).resolves.toMatchObject({ code: "INVALID_INPUT" });
    expect(mocks.signing.decide).not.toHaveBeenCalled();
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
      { reason: "Wrong legal entity" },
    );
  });

  it("voids for a different signer with the code and no reason", async () => {
    as("legal_approver");
    mocks.workflow.void.mockResolvedValue({ state: "canceled" });
    await expect(
      voidContract({ contractId, code: "signer_change" }),
    ).resolves.toEqual({ ok: true, value: { state: "canceled" } });
    expect(mocks.workflow.void).toHaveBeenCalledWith(
      contractId,
      expect.anything(),
      { code: "signer_change" },
    );
    await expect(
      voidContract({ contractId, code: "superseded" }),
    ).resolves.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      voidContract({ contractId, code: "signer_change", reason: "Both" }),
    ).resolves.toMatchObject({ code: "INVALID_INPUT" });
    expect(mocks.workflow.void).toHaveBeenCalledOnce();
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

describe("correctContractSigner", () => {
  it("lets the preparer fix the counterparty's email, lowercased", async () => {
    as("revenue");
    mocks.signing.get.mockResolvedValue({
      preparerId: "019a44ac-0000-7000-8000-0000000000aa",
    });
    mocks.workflow.correctSigner.mockResolvedValue({
      state: "sent",
      counterpartySigner: { email: "alex@example.com" },
      correctedSignerEmail: "right@example.com",
    });
    await expect(
      correctContractSigner({ contractId, signerEmail: "Right@Example.com" }),
    ).resolves.toEqual({
      ok: true,
      value: { state: "sent", signerEmail: "right@example.com" },
    });
    expect(mocks.workflow.correctSigner).toHaveBeenCalledWith(
      contractId,
      expect.objectContaining({ id: "019a44ac-0000-7000-8000-0000000000aa" }),
      "right@example.com",
    );
  });

  it("needs an approver for a colleague's request, and a valid email", async () => {
    as("revenue");
    mocks.signing.get.mockResolvedValue({
      preparerId: "019a44ac-0000-7000-8000-0000000000bb",
    });
    await expect(
      correctContractSigner({ contractId, signerEmail: "right@example.com" }),
    ).resolves.toEqual({ ok: false, code: "CONTRACT_NOT_PREPARER" });
    as("commerce_admin");
    await expect(
      correctContractSigner({ contractId, signerEmail: "not an email" }),
    ).resolves.toMatchObject({ code: "INVALID_INPUT" });
    as("finance_approver");
    await expect(
      correctContractSigner({ contractId, signerEmail: "right@example.com" }),
    ).resolves.toMatchObject({ ok: false });
    expect(mocks.workflow.correctSigner).not.toHaveBeenCalled();
  });

  it("passes the workflow's refusal codes through", async () => {
    as("commerce_admin");
    mocks.workflow.correctSigner.mockRejectedValue(
      new Error("CONTRACT_SIGNER_STARTED"),
    );
    await expect(
      correctContractSigner({ contractId, signerEmail: "right@example.com" }),
    ).resolves.toEqual({ ok: false, code: "CONTRACT_SIGNER_STARTED" });
  });
});

describe("prepareCounterpartyPaper", () => {
  const fileId = "019a44ac-0000-7000-8000-0000000000f1";
  const sha256 = "c".repeat(64);
  beforeEach(() => {
    mocks.repository.readFile.mockResolvedValue({
      file: { id: fileId, sha256, kind: "counterparty_draft" },
      contract: {
        counterpartyName: "Bluefin Data Co.",
        contractType: "other",
        paper: "theirs",
        title: "",
      },
      bytes: Buffer.from("%PDF-their paper"),
    });
    mocks.renderPaper.mockResolvedValue({
      bytes: Buffer.from("%PDF-their paper with the Fil One page"),
      sha256: "d".repeat(64),
      pages: 3,
    });
    mocks.signing.prepareCounterpartyPaper.mockResolvedValue({
      record: { state: "draft" },
      duplicate: false,
    });
  });

  it("appends the Fil One page to the PDF it read and records the request for Fil One alone", async () => {
    as("revenue");
    await expect(
      prepareCounterpartyPaper({
        contractId,
        fileId,
        countersignerId: countersigner.id,
        signers: "fil-one",
      }),
    ).resolves.toEqual({ ok: true, value: { state: "draft" } });
    expect(mocks.repository.readFile).toHaveBeenCalledWith(contractId, fileId);
    expect(mocks.renderPaper).toHaveBeenCalledWith(
      Buffer.from("%PDF-their paper"),
      expect.objectContaining({
        sourceSha256: sha256,
        counterpartyName: "Bluefin Data Co.",
        counterpartySigner: null,
        countersigner,
      }),
    );
    expect(mocks.signing.prepareCounterpartyPaper).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId,
        source: { fileId, sha256 },
        counterpartySigner: null,
        countersignerId: countersigner.id,
        testMode: true,
        documentName: "Fil One countersignature - Bluefin Data Co.",
        // The seller is copied on the signed copy.
        preparerEmail: "seller@fil.one",
      }),
      expect.objectContaining({ id: "019a44ac-0000-7000-8000-0000000000aa" }),
    );
  });

  it("names Fil One's own PDF by its title", async () => {
    as("revenue");
    mocks.repository.readFile.mockResolvedValue({
      file: { id: fileId, sha256, kind: "main" },
      contract: {
        counterpartyName: "Bluefin Data Co.",
        contractType: "channel_partnership",
        paper: "ours",
        title: "Referral term sheet",
      },
      bytes: Buffer.from("%PDF-our term sheet"),
    });
    await expect(
      prepareCounterpartyPaper({
        contractId,
        fileId,
        countersignerId: countersigner.id,
        signers: "counterparty_then_fil_one",
        signerName: "Alex Example",
        signerEmail: "alex@example.com",
        signerTitle: "CEO",
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(mocks.signing.prepareCounterpartyPaper).toHaveBeenCalledWith(
      expect.objectContaining({
        documentName: "Fil One Referral term sheet - Bluefin Data Co.",
      }),
      expect.anything(),
    );
  });

  it("takes the counterparty signer when they sign in SignWell first, distinct from Fil One's", async () => {
    as("revenue");
    const both = {
      contractId,
      fileId,
      countersignerId: countersigner.id,
      signers: "counterparty_then_fil_one",
      signerName: "Alex Example",
      signerEmail: "Alex@Example.com",
      signerTitle: "CEO",
    };
    await expect(prepareCounterpartyPaper(both)).resolves.toMatchObject({
      ok: true,
    });
    expect(mocks.signing.prepareCounterpartyPaper).toHaveBeenCalledWith(
      expect.objectContaining({
        counterpartySigner: {
          name: "Alex Example",
          email: "alex@example.com",
          title: "CEO",
        },
      }),
      expect.anything(),
    );
    await expect(
      prepareCounterpartyPaper({ ...both, signerEmail: countersigner.email }),
    ).resolves.toEqual({
      ok: false,
      code: "CONTRACT_DISTINCT_SIGNERS_REQUIRED",
    });
    await expect(
      prepareCounterpartyPaper({ ...both, signerEmail: "" }),
    ).resolves.toMatchObject({
      code: "INVALID_INPUT",
      fields: { signerEmail: "email" },
    });
  });

  it("needs contract:write and passes refusals through as codes", async () => {
    as("finance_approver");
    await expect(
      prepareCounterpartyPaper({
        contractId,
        fileId,
        countersignerId: countersigner.id,
        signers: "fil-one",
      }),
    ).resolves.toMatchObject({ ok: false });
    as("revenue");
    mocks.renderPaper.mockRejectedValueOnce(
      new Error("CONTRACT_PAPER_UNREADABLE"),
    );
    await expect(
      prepareCounterpartyPaper({
        contractId,
        fileId,
        countersignerId: countersigner.id,
        signers: "fil-one",
      }),
    ).resolves.toEqual({ ok: false, code: "CONTRACT_PAPER_UNREADABLE" });
    expect(mocks.signing.prepareCounterpartyPaper).not.toHaveBeenCalled();
  });
});

describe("resendContract", () => {
  it("sends the ended request again, as the seller, in the configured mode", async () => {
    as("revenue");
    mocks.signing.resend.mockResolvedValue({
      record: { state: "draft", requestNumber: 3 },
      duplicate: false,
    });
    await expect(
      resendContract({ contractId, requestNumber: 2 }),
    ).resolves.toEqual({
      ok: true,
      value: { state: "draft", requestNumber: 3 },
    });
    expect(mocks.signing.resend).toHaveBeenCalledWith(
      contractId,
      2,
      { testMode: true, preparerEmail: "seller@fil.one" },
      expect.objectContaining({ id: "019a44ac-0000-7000-8000-0000000000aa" }),
    );
  });

  it("needs contract:write, a request number, and passes refusals through", async () => {
    as("finance_approver");
    await expect(
      resendContract({ contractId, requestNumber: 1 }),
    ).resolves.toMatchObject({ ok: false });
    as("revenue");
    await expect(resendContract({ contractId })).resolves.toMatchObject({
      code: "INVALID_INPUT",
    });
    mocks.signing.resend.mockRejectedValueOnce(
      new Error("CONTRACT_SIGNING_EXISTS"),
    );
    await expect(
      resendContract({ contractId, requestNumber: 1 }),
    ).resolves.toEqual({ ok: false, code: "CONTRACT_SIGNING_EXISTS" });
    expect(mocks.signing.resend).toHaveBeenCalledTimes(1);
  });
});

describe("actions on a replaced request", () => {
  it("refuses an approval, operation, void or correction made on an earlier request", async () => {
    as("commerce_admin");
    mocks.signing.get.mockResolvedValue({
      requestNumber: 3,
      preparerId: "019a44ac-0000-7000-8000-0000000000aa",
    });
    mocks.signing.decide.mockRejectedValue(
      new Error("CONTRACT_REQUEST_CHANGED"),
    );
    const stale = { contractId, requestNumber: 2 };
    await expect(decideContract({ ...stale, approve: true })).resolves.toEqual({
      ok: false,
      code: "CONTRACT_REQUEST_CHANGED",
    });
    expect(mocks.signing.decide).toHaveBeenCalledWith(
      contractId,
      { approve: true },
      expect.anything(),
      2,
    );
    for (const result of [
      operateContract({ ...stale, operation: "send" }),
      voidContract({ ...stale, reason: "Wrong PDF" }),
      correctContractSigner({ ...stale, signerEmail: "right@example.com" }),
    ])
      await expect(result).resolves.toEqual({
        ok: false,
        code: "CONTRACT_REQUEST_CHANGED",
      });
    expect(mocks.workflow.send).not.toHaveBeenCalled();
    expect(mocks.workflow.void).not.toHaveBeenCalled();
    expect(mocks.workflow.correctSigner).not.toHaveBeenCalled();
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
