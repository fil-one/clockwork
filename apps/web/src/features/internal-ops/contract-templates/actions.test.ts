import type * as ContractServer from "../contracts/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureSectionsContent } from "../../../../../../packages/documents/src/__fixtures__/contract-template";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  demo: vi.fn(() => false),
  repository: {
    list: vi.fn(),
    get: vi.fn(),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    activate: vi.fn(),
    retire: vi.fn(),
    discard: vi.fn(),
  },
}));
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.session,
  getRequestCommerceSession: mocks.session,
  explicitDemoIdentityEnabled: mocks.demo,
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: vi.fn() }));
vi.mock("../contracts/server", async (original) => ({
  ...(await original<typeof ContractServer>()),
  contractTemplateRepository: () => mocks.repository,
}));
import {
  activateTemplateVersion,
  checkTemplateFile,
  createTemplateDraft,
  renderTemplateSpecimen,
  saveTemplateDraft,
} from "./actions";
import { permissionsForRoles } from "@clockwork/contracts";

const as = (role: string, patch: Record<string, unknown> = {}) =>
  mocks.session.mockResolvedValue({
    userId: "019a44ac-0000-7000-8000-0000000000aa",
    profile: { name: "Elena Brooks", email: "elena@fil.one" },
    roles: [role],
    permissions: permissionsForRoles([role]),
    isInternalStaff: true,
    mfaVerified: true,
    ...patch,
  });
const id = "019a44ac-0000-7000-8000-0000000000d1";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.demo.mockReturnValue(false);
  mocks.repository.list.mockResolvedValue([
    { key: "test-sections", version: 2, status: "active", versionLabel: "v2" },
  ]);
  mocks.repository.createDraft.mockResolvedValue({ id });
  mocks.repository.updateDraft.mockResolvedValue({
    revision: 2,
    contentHash: "a".repeat(64),
  });
  mocks.repository.activate.mockResolvedValue({ revision: 3 });
});

describe("template store actions", () => {
  it("are for commerce administrators in a verified session", async () => {
    for (const role of ["revenue", "legal_approver", "internal_operator"]) {
      as(role);
      await expect(
        createTemplateDraft({ id, origin: "import", content: {} }),
      ).resolves.toEqual({ ok: false, code: "CONTRACT_FORBIDDEN" });
    }
    as("commerce_admin", { mfaVerified: false });
    await expect(activateTemplateVersion({ id, revision: 1 })).resolves.toEqual(
      { ok: false, code: "CONTRACT_MFA_REQUIRED" },
    );
    expect(mocks.repository.activate).not.toHaveBeenCalled();
  });

  it("checks a file and says which version it becomes, saving nothing", async () => {
    as("commerce_admin");
    const result = await checkTemplateFile(
      JSON.stringify(fixtureSectionsContent),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { nextVersion: 3, activeVersion: "v2" },
    });
    await expect(checkTemplateFile("{not json")).resolves.toEqual({
      ok: false,
      code: "CONTRACT_TEMPLATE_JSON",
    });
    const broken = structuredClone(fixtureSectionsContent);
    broken.document.blocks.push({ type: "paragraph", text: "[[missing]]" });
    await expect(checkTemplateFile(JSON.stringify(broken))).resolves.toEqual({
      ok: false,
      code: "CONTRACT_TEMPLATE_INVALID",
      issues: [
        {
          path: ["document", "blocks", 6],
          message: "undeclared token [[missing]]",
        },
      ],
    });
    expect(mocks.repository.createDraft).not.toHaveBeenCalled();
  });

  it("saves drafts and activates them as the signed-in administrator", async () => {
    as("commerce_admin");
    await expect(
      createTemplateDraft({
        id,
        origin: "import",
        content: fixtureSectionsContent,
      }),
    ).resolves.toEqual({ ok: true, value: { id } });
    const actor = {
      kind: "user",
      id: "019a44ac-0000-7000-8000-0000000000aa",
      display: "Elena Brooks",
    };
    expect(mocks.repository.createDraft).toHaveBeenCalledWith(
      fixtureSectionsContent,
      actor,
      "import",
      id,
    );
    await expect(
      saveTemplateDraft({ id, revision: 1, content: fixtureSectionsContent }),
    ).resolves.toMatchObject({ ok: true, value: { revision: 2 } });
    await expect(activateTemplateVersion({ id, revision: 2 })).resolves.toEqual(
      { ok: true, value: { revision: 3 } },
    );
    expect(mocks.repository.activate).toHaveBeenCalledWith(id, 2, actor);
  });

  it("previews a specimen in the guided demo and refuses every save there", async () => {
    mocks.demo.mockReturnValue(true);
    as("commerce_admin");
    const specimen = await renderTemplateSpecimen(fixtureSectionsContent);
    expect(specimen.ok).toBe(true);
    await expect(
      createTemplateDraft({
        id,
        origin: "import",
        content: fixtureSectionsContent,
      }),
    ).resolves.toEqual({ ok: false, code: "CONTRACT_DEMO_UNAVAILABLE" });
    await expect(activateTemplateVersion({ id, revision: 1 })).resolves.toEqual(
      { ok: false, code: "CONTRACT_DEMO_UNAVAILABLE" },
    );
    as("revenue");
    await expect(
      renderTemplateSpecimen(fixtureSectionsContent),
    ).resolves.toEqual({ ok: false, code: "CONTRACT_FORBIDDEN" });
    expect(mocks.repository.createDraft).not.toHaveBeenCalled();
  }, 30_000);
});
