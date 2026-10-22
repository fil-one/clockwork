import { beforeEach, expect, it, vi } from "vitest";
import type * as Http from "../contracts/http";
import type * as Server from "./server";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  demo: vi.fn(),
  form: vi.fn(),
  repo: { add: vi.fn(), read: vi.fn() },
}));
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.session,
  explicitDemoIdentityEnabled: mocks.demo,
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: vi.fn() }));
vi.mock("./server", async (original) => ({
  ...(await original<typeof Server>()),
  accountDocumentRepository: () => mocks.repo,
}));
vi.mock("../contracts/http", async (original) => ({
  ...(await original<typeof Http>()),
  readUploadForm: mocks.form,
  uploadedPdf: () => ({
    fileName: "Signed MNDA.pdf",
    bytes: new Uint8Array([37, 80, 68, 70, 45]),
  }),
}));
import { POST as uploadAccountDocument } from "@/app/(experience)/(internal)/internal/record-documents/[type]/[id]/route";
import { GET as downloadAccountDocument } from "@/app/(experience)/(internal)/internal/record-documents/[type]/[id]/[fileId]/route";
const origin = "https://commerce.fil.one";
const id = "10000000-0000-4000-8000-000000000001";
const fileId = "90000000-0000-4000-8000-000000000001";
const params = (type = "partner", targetId = id) => ({
  params: Promise.resolve({ type, id: targetId, fileId }),
});
const request = (from = origin) =>
  new Request(`${origin}/upload`, {
    method: "POST",
    headers: { origin: from },
  });
const session = (patch = {}) => ({
  userId: id,
  profile: { name: "Staff" },
  roles: [],
  permissions: ["sales:read", "operations:read", "contract:write"],
  isInternalStaff: true,
  mfaVerified: true,
  ...patch,
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", origin);
  mocks.demo.mockReturnValue(false);
  mocks.session.mockResolvedValue(session());
  const form = new FormData();
  form.set(
    "item",
    JSON.stringify({
      id: fileId,
      title: "External MNDA",
      kind: "mnda",
      signedOn: "2026-10-10",
    }),
  );
  mocks.form.mockResolvedValue(form);
  mocks.repo.add.mockResolvedValue({ id: fileId });
  mocks.repo.read.mockResolvedValue({
    file: { fileName: "Signed MNDA.pdf" },
    bytes: new Uint8Array([37, 80, 68, 70, 45]),
  });
});
it.each(["partner", "account"])(
  "uploads to an explicit %s target using the authenticated actor",
  async (type) => {
    const response = await uploadAccountDocument(request(), params(type));
    expect(response.status).toBe(200);
    expect(mocks.repo.add).toHaveBeenCalledWith(
      { type, id },
      expect.objectContaining({ id: fileId, kind: "mnda" }),
      expect.anything(),
      { kind: "user", id, display: "Staff" },
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  },
);
it("rejects cross-origin upload before reading the body or session", async () => {
  expect(
    (await uploadAccountDocument(request("https://elsewhere.test"), params()))
      .status,
  ).toBe(403);
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.form).not.toHaveBeenCalled();
});
it.each([
  [{ isInternalStaff: false }, 403],
  [{ mfaVerified: false }, 401],
  [{ impersonation: {} }, 403],
  [{ assistedSession: {} }, 403],
  [{ permissions: ["sales:read"] }, 403],
  [{ permissions: ["contract:write"] }, 403],
])(
  "refuses unauthorized upload %j before reading bytes",
  async (patch, status) => {
    mocks.session.mockResolvedValue(session(patch));
    expect((await uploadAccountDocument(request(), params())).status).toBe(
      status,
    );
    expect(mocks.repo.add).not.toHaveBeenCalled();
    expect(mocks.form).not.toHaveBeenCalled();
  },
);
it("does not let a partner-only reader access account files", async () => {
  mocks.session.mockResolvedValue(
    session({ permissions: ["sales:read", "contract:write"] }),
  );
  expect(
    (await downloadAccountDocument(new Request(origin), params("account")))
      .status,
  ).toBe(403);
  expect(mocks.repo.read).not.toHaveBeenCalled();
});
it("never lets demo identities reach stored evidence", async () => {
  mocks.demo.mockReturnValue(true);
  expect(
    (await downloadAccountDocument(new Request(origin), params())).status,
  ).toBe(403);
  expect(mocks.repo.read).not.toHaveBeenCalled();
});
it("allows read-only staff to download, with private and sandboxed PDF headers", async () => {
  mocks.session.mockResolvedValue(session({ permissions: ["sales:read"] }));
  const response = await downloadAccountDocument(
    new Request(`${origin}/file?view=1`),
    params(),
  );
  expect(response.status).toBe(200);
  expect(mocks.repo.read).toHaveBeenCalledWith(
    { type: "partner", id },
    fileId,
    { kind: "user", id, display: "Staff" },
  );
  expect(response.headers.get("content-disposition")).toMatch(/^inline;/);
  expect(response.headers.get("content-security-policy")).toBe("sandbox");
  expect(response.headers.get("cache-control")).toContain("no-store");
});
it("returns safe not-found and validation failures", async () => {
  expect(
    (await uploadAccountDocument(request(), params("unknown"))).status,
  ).toBe(422);
  mocks.repo.read.mockRejectedValue(new Error("ATTACHMENT_NOT_FOUND"));
  expect(
    (await downloadAccountDocument(new Request(origin), params())).status,
  ).toBe(404);
  mocks.repo.add.mockRejectedValue(
    new Error("database credentials must not leak"),
  );
  const response = await uploadAccountDocument(request(), params());
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ ok: false, code: "UNEXPECTED" });
});
