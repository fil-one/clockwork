import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fixtureInput,
  fixtureRecord,
  fixtureSigner,
} from "../../../../../../packages/contracts/src/mnda-fixture";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  repository: {
    list: vi.fn(),
    settings: vi.fn(),
    signers: vi.fn(),
    saveSigner: vi.fn(),
    saveSettings: vi.fn(),
    create: vi.fn(),
    duplicates: vi.fn(),
    contractDuplicates: vi.fn(),
    exportRows: vi.fn(),
    get: vi.fn(),
    readArtifact: vi.fn(),
    recordAccess: vi.fn(),
  },
  workflow: {
    send: vi.fn(),
    sync: vi.fn(),
    remind: vi.fn(),
    cancel: vi.fn(),
    void: vi.fn(),
    correctSigner: vi.fn(),
  },
  render: vi.fn(),
}));
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.session,
  explicitDemoIdentityEnabled: () => false,
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: vi.fn() }));
vi.mock("@/src/i18n/server", async () => {
  const { translatorFor } = await import("@/src/i18n/catalogs");
  return { getTranslations: () => Promise.resolve(translatorFor("en")) };
});
vi.mock("@clockwork/db", () => ({
  MndaRepository: vi.fn(function MndaRepository() {
    return mocks.repository;
  }),
}));
vi.mock("@clockwork/workflows/mnda", () => ({
  MndaWorkflow: vi.fn(function MndaWorkflow() {
    return mocks.workflow;
  }),
}));
vi.mock("@clockwork/integrations", () => ({
  SignWellClient: vi.fn(),
}));
vi.mock("@clockwork/documents", () => ({
  mndaTemplateHash: "b".repeat(64),
  renderMnda: mocks.render,
}));
import {
  configureMndaSigner,
  correctMndaSigner,
  findMndaDuplicates,
  loadMndas,
  operateMnda,
  prepareMnda,
  saveMndaSettings,
  voidMnda,
} from "./actions";
import { GET as exportCsv } from "../../../../app/(experience)/(internal)/internal/mndas/export/route";
import { GET as pdf } from "../../../../app/(experience)/(internal)/internal/mndas/[id]/pdf/route";

const as = (role: string, patch: object = {}) =>
  mocks.session.mockResolvedValue({
    userId: "019a44ac-0000-7000-8000-000000000006",
    profile: { email: "rw@fil.one", name: "R.W. Holleman" },
    roles: [role],
    isInternalStaff: true,
    mfaVerified: true,
    ...patch,
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("COMMERCE_MNDA_ENABLED", "true");
  vi.stubEnv("SIGNWELL_API_KEY", "key");
  vi.stubEnv("SIGNWELL_WEBHOOK_ID", "hook");
  mocks.repository.signers.mockResolvedValue([
    { ...fixtureSigner, version: 1 },
  ]);
  mocks.repository.settings.mockResolvedValue({
    noticeEmail: "legal@fil.one",
    version: 3,
    updatedAt: null,
    updatedBy: null,
  });
  mocks.repository.list.mockResolvedValue({
    records: [],
    total: 0,
    page: 1,
    pageSize: 25,
  });
  mocks.repository.create.mockResolvedValue(fixtureRecord);
  // By default the signed-in seller prepared the MNDA being acted on.
  mocks.repository.get.mockResolvedValue({
    ...fixtureRecord,
    ownerId: "019a44ac-0000-7000-8000-000000000006",
  });
  mocks.render.mockResolvedValue({ bytes: Buffer.from("%PDF-x") });
});

describe("sending requires mnda:send", () => {
  it("lets a revenue seller prepare a draft with the configured notice email", async () => {
    as("revenue");
    const result = await prepareMnda({ input: fixtureInput });
    expect(result).toEqual({ ok: true, value: fixtureRecord });
    expect(mocks.render).toHaveBeenCalledWith(
      expect.objectContaining({ company: fixtureInput.company }),
      fixtureSigner,
      { noticeEmail: "legal@fil.one" },
    );
    const owner = mocks.repository.create.mock.calls[0]?.[1] as unknown;
    expect(owner).toMatchObject({ name: "R.W. Holleman", email: "rw@fil.one" });
    expect(mocks.repository.create.mock.calls[0]?.[6]).toBe("legal@fil.one");
  });
  it.each(["destructive_action_approver", "owner"])(
    "refuses %s for every MNDA action",
    async (role) => {
      as(role, role === "owner" ? { isInternalStaff: false } : {});
      for (const result of await Promise.all([
        loadMndas(),
        prepareMnda({ input: fixtureInput }),
        operateMnda({ id: fixtureRecord.id, operation: "send" }),
        voidMnda({ id: fixtureRecord.id, reason: "Wrong entity" }),
        correctMndaSigner({ id: fixtureRecord.id, signerEmail: "a@b.co" }),
      ]))
        expect(result).toEqual({ ok: false, code: "forbidden" });
      expect(mocks.workflow.send).not.toHaveBeenCalled();
      expect(mocks.repository.create).not.toHaveBeenCalled();
    },
  );
  it("asks an unverified session to verify with MFA", async () => {
    as("revenue", { mfaVerified: false });
    expect(await loadMndas()).toEqual({ ok: false, code: "mfa_required" });
  });
  it("tells the seller exactly which field is wrong", async () => {
    as("revenue");
    const result = await prepareMnda({
      input: {
        ...fixtureInput,
        company: "Acme <script>",
        signerEmail: "not-an-email",
      },
    });
    expect(result).toEqual({
      ok: false,
      code: "invalid_characters",
      fields: [
        { field: "company", code: "invalid_characters" },
        { field: "signerEmail", code: "invalid_email" },
      ],
    });
    expect(
      await prepareMnda({
        input: { ...fixtureInput, signerEmail: fixtureSigner.email },
      }),
    ).toEqual({
      ok: false,
      code: "same_as_countersigner",
      fields: [{ field: "signerEmail", code: "same_as_countersigner" }],
    });
  });
  it("maps workflow failures to stable codes without provider details", async () => {
    as("revenue");
    mocks.workflow.remind.mockRejectedValueOnce(
      new Error("MNDA_REMINDER_TOO_SOON"),
    );
    expect(
      await operateMnda({ id: fixtureRecord.id, operation: "remind" }),
    ).toEqual({ ok: false, code: "reminder_cooldown" });
    mocks.workflow.send.mockRejectedValueOnce(new Error("SIGNWELL_HTTP_500"));
    expect(
      await operateMnda({ id: fixtureRecord.id, operation: "send" }),
    ).toEqual({ ok: false, code: "provider_failed" });
    expect(await voidMnda({ id: fixtureRecord.id, reason: " " })).toMatchObject(
      { ok: false, code: "reason_required" },
    );
    mocks.workflow.void.mockResolvedValueOnce(fixtureRecord);
    await voidMnda({ id: fixtureRecord.id, reason: "Wrong entity" });
    expect(mocks.workflow.void).toHaveBeenCalledWith(
      fixtureRecord.id,
      expect.objectContaining({ kind: "user" }),
      { reason: "Wrong entity" },
    );
  });
});

describe("settings require signatory:manage", () => {
  it.each([
    "revenue",
    "internal_operator",
    "finance_approver",
    "legal_approver",
  ])("refuses %s", async (role) => {
    as(role);
    expect(await configureMndaSigner(fixtureSigner)).toEqual({
      ok: false,
      code: "forbidden",
    });
    expect(
      await saveMndaSettings({ noticeEmail: "x@fil.one", version: 3 }),
    ).toEqual({ ok: false, code: "forbidden" });
    expect(mocks.repository.saveSigner).not.toHaveBeenCalled();
    expect(mocks.repository.saveSettings).not.toHaveBeenCalled();
  });
  it("lets a commerce administrator change the notice email and countersigners", async () => {
    as("commerce_admin");
    expect(
      await saveMndaSettings({ noticeEmail: "Legal@Fil.One", version: 3 }),
    ).toEqual({ ok: true, value: null });
    expect(mocks.repository.saveSettings).toHaveBeenCalledWith(
      { noticeEmail: "legal@fil.one" },
      3,
      expect.objectContaining({ id: "019a44ac-0000-7000-8000-000000000006" }),
    );
    expect(
      await saveMndaSettings({ noticeEmail: "legal", version: 3 }),
    ).toEqual({
      ok: false,
      code: "invalid_email",
      fields: [{ field: "noticeEmail", code: "invalid_email" }],
    });
    expect(await configureMndaSigner(fixtureSigner)).toEqual({
      ok: true,
      value: null,
    });
  });
});

describe("routes re-check the session", () => {
  it("refuses the CSV and PDF routes without mnda:send", async () => {
    as("destructive_action_approver");
    expect(
      (await exportCsv(new Request("http://x/internal/mndas/export"))).status,
    ).toBe(403);
    expect(
      (
        await pdf(new Request("http://x/pdf"), {
          params: Promise.resolve({ id: fixtureRecord.id }),
        })
      ).status,
    ).toBe(403);
  });
  it("exports the filtered register and names PDFs for a deal folder", async () => {
    as("revenue");
    mocks.repository.exportRows.mockResolvedValue({
      records: [
        { ...fixtureRecord, state: "sent", sentAt: "2026-10-01T00:00:00Z" },
      ],
      truncated: false,
    });
    const csv = await exportCsv(
      new Request("http://x/internal/mndas/export?status=sent,viewed&mine=1"),
    );
    expect(mocks.repository.exportRows).toHaveBeenCalledWith(
      expect.objectContaining({ status: ["sent", "viewed"], mine: true }),
      "019a44ac-0000-7000-8000-000000000006",
    );
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const text = await csv.text();
    expect(text).toContain(
      "Example Corporation,Alex Example,alex@example.com,Sent to partner,sent,",
    );
    mocks.repository.get.mockResolvedValue({
      ...fixtureRecord,
      completedAt: "2026-10-03T12:00:00Z",
    });
    mocks.repository.readArtifact.mockResolvedValue(Buffer.from("%PDF-1"));
    const response = await pdf(
      new Request("http://x/pdf?kind=executed&download=1"),
      { params: Promise.resolve({ id: fixtureRecord.id }) },
    );
    expect(response.headers.get("content-disposition")).toContain(
      'attachment; filename="Fil-One-MNDA_Example-Corporation_2026-10-03_signed.pdf"',
    );
  });
});

describe("only the preparer or a signatory manager changes a sent MNDA", () => {
  const others = {
    ...fixtureRecord,
    ownerId: "019a44ac-0000-7000-8000-0000000000ff",
  };
  it("refuses void, discard and email fixes on a colleague's MNDA but allows reminders", async () => {
    as("revenue");
    mocks.repository.get.mockResolvedValue(others);
    for (const result of [
      await voidMnda({ id: others.id, reason: "Wrong entity" }),
      await voidMnda({ id: others.id, code: "signer_change" }),
      await correctMndaSigner({ id: others.id, signerEmail: "a@b.co" }),
      await operateMnda({ id: others.id, operation: "cancel" }),
    ])
      expect(result).toEqual({ ok: false, code: "not_owner" });
    expect(mocks.workflow.void).not.toHaveBeenCalled();
    expect(mocks.workflow.correctSigner).not.toHaveBeenCalled();
    expect(mocks.workflow.cancel).not.toHaveBeenCalled();
    mocks.workflow.remind.mockResolvedValueOnce(others);
    expect(
      await operateMnda({ id: others.id, operation: "remind" }),
    ).toMatchObject({ ok: true });
  });
  it("lets the preparer and a commerce administrator act", async () => {
    mocks.workflow.void.mockResolvedValue(fixtureRecord);
    as("revenue", { userId: fixtureRecord.ownerId });
    mocks.repository.get.mockResolvedValue(fixtureRecord);
    expect(
      await voidMnda({ id: fixtureRecord.id, code: "signer_change" }),
    ).toMatchObject({ ok: true });
    expect(mocks.workflow.void).toHaveBeenLastCalledWith(
      fixtureRecord.id,
      expect.anything(),
      { code: "signer_change" },
    );
    as("commerce_admin");
    mocks.repository.get.mockResolvedValue(others);
    expect(
      await voidMnda({ id: others.id, reason: "Wrong entity" }),
    ).toMatchObject({ ok: true });
  });
  it("lets only a signatory manager replace a colleague's draft", async () => {
    as("revenue");
    await prepareMnda({ input: fixtureInput, supersedes: [others.id] });
    expect(mocks.repository.create.mock.calls.at(-1)?.[7]).toEqual({
      supersedes: [others.id],
      manageAll: false,
    });
    as("commerce_admin");
    await prepareMnda({ input: fixtureInput, supersedes: [others.id] });
    expect(mocks.repository.create.mock.calls.at(-1)?.[7]).toMatchObject({
      manageAll: true,
    });
    mocks.repository.create.mockRejectedValueOnce(
      new Error("MNDA_SETTINGS_CHANGED"),
    );
    expect(await prepareMnda({ input: fixtureInput })).toEqual({
      ok: false,
      code: "settings_changed",
    });
  });
});

describe("downloads and exports are audited", () => {
  it("records PDF downloads and register exports, and flags a truncated export", async () => {
    as("revenue");
    mocks.repository.get.mockResolvedValue(fixtureRecord);
    mocks.repository.readArtifact.mockResolvedValue(Buffer.from("%PDF-1"));
    await pdf(new Request("http://x/pdf?kind=original"), {
      params: Promise.resolve({ id: fixtureRecord.id }),
    });
    expect(mocks.repository.recordAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: "019a44ac-0000-7000-8000-000000000006" }),
      { kind: "pdf", requestId: fixtureRecord.id, artifact: "original" },
    );
    mocks.repository.exportRows.mockResolvedValue({
      records: [fixtureRecord],
      truncated: true,
    });
    const csv = await exportCsv(
      new Request("http://x/internal/mndas/export?status=completed"),
    );
    expect(csv.headers.get("x-mnda-export-truncated")).toBe("true");
    expect(mocks.repository.recordAccess).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "export",
        rows: 1,
        truncated: true,
      }),
    );
    const exported = mocks.repository.recordAccess.mock.calls.at(-1)?.[1] as
      { filters: { status: string[] } } | undefined;
    expect(exported?.filters.status).toEqual(["completed"]);
  });
  it("answers a failed export with a plain message instead of a broken file", async () => {
    as("revenue");
    mocks.repository.exportRows.mockRejectedValue(new Error("db down"));
    const response = await exportCsv(
      new Request("http://x/internal/mndas/export"),
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("could not be prepared");
  });
});

describe("duplicate checks", () => {
  const contract = {
    id: "019a44ac-0000-7000-8000-0000000000c1",
    counterpartyName: "ACME, Inc.",
    contractType: "mnda",
    status: "executed",
    effectiveDate: "2026-03-01",
    ownerName: "R.W. Holleman",
  };
  it("adds register contracts for staff who may read contracts", async () => {
    as("revenue");
    mocks.repository.duplicates.mockResolvedValue([]);
    mocks.repository.contractDuplicates.mockResolvedValue([contract]);
    expect(await findMndaDuplicates({ company: "Acme Corp" })).toEqual({
      ok: true,
      value: { mndas: [], contracts: [contract] },
    });
    expect(mocks.repository.contractDuplicates).toHaveBeenCalledWith(
      "Acme Corp",
    );
  });
  it("leaves contracts out for a session without contract:read", async () => {
    as("revenue", { permissions: ["mnda:send"] });
    mocks.repository.duplicates.mockResolvedValue([]);
    expect(await findMndaDuplicates({ company: "Acme Corp" })).toEqual({
      ok: true,
      value: { mndas: [], contracts: [] },
    });
    expect(mocks.repository.contractDuplicates).not.toHaveBeenCalled();
  });
});

describe("partner-completes drafts are retired", () => {
  it("refuses a new draft in that mode without storing it", async () => {
    as("revenue");
    expect(
      await prepareMnda({
        input: { ...fixtureInput, detailsMode: "recipient" },
      }),
    ).toEqual({
      ok: false,
      code: "invalid_value",
      fields: [{ field: "detailsMode", code: "invalid_value" }],
    });
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.repository.create).not.toHaveBeenCalled();
  });
});
