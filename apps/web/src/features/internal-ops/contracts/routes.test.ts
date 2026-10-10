import type * as Http from "./http";
import type * as Server from "./server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  // jsdom's File class trips Node's multipart parser, so a test hands the
  // route its parsed form directly. `http.integration.test.ts` covers the
  // real parser on the Node runtime.
  forms: new WeakMap<Request, FormData>(),
  session: vi.fn(),
  repository: {
    addFile: vi.fn(),
    readFile: vi.fn(),
    exportRows: vi.fn(),
    recordAccess: vi.fn(),
  },
  library: {
    create: vi.fn(),
    update: vi.fn(),
    readFile: vi.fn(),
    recordDownload: vi.fn(),
  },
}));
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.session,
  explicitDemoIdentityEnabled: () => false,
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: vi.fn() }));
vi.mock("./http", async (original) => {
  const actual = await original<typeof Http>();
  return {
    ...actual,
    readUploadForm: (request: Request) => {
      const form = mocks.forms.get(request);
      return form ? Promise.resolve(form) : actual.readUploadForm(request);
    },
  };
});
vi.mock("./server", async (original) => ({
  ...(await original<typeof Server>()),
  contractRepository: () => mocks.repository,
  salesLibraryRepository: () => mocks.library,
}));
import { POST as upload } from "@/app/(experience)/(internal)/internal/contracts/[id]/files/route";
import { GET as download } from "@/app/(experience)/(internal)/internal/contracts/[id]/files/[fileId]/route";
import { GET as exportCsv } from "@/app/(experience)/(internal)/internal/contracts/export/route";
import { POST as addCollateral } from "@/app/(experience)/(internal)/internal/sales-library/items/route";
import { GET as collateralFile } from "@/app/(experience)/(internal)/internal/sales-library/items/[id]/route";
import { contentDisposition } from "./http";

const origin = "https://commerce.fil.one";
const contractId = "019a44ac-0000-7000-8000-0000000000c1";
const fileId = "019a44ac-0000-7000-8000-0000000000f1";
const as = (role: string) =>
  mocks.session.mockResolvedValue({
    userId: "019a44ac-0000-7000-8000-0000000000aa",
    profile: { name: "Seller", email: "seller@fil.one" },
    roles: [role],
    isInternalStaff: true,
    mfaVerified: true,
  });
const pdf = new File(["%PDF-1.7\nbody\n%%EOF"], "Signed MSA.pdf", {
  type: "application/pdf",
});
function formRequest(form: FormData, from = origin) {
  const request = new Request(`${origin}/x`, {
    method: "POST",
    headers: {
      origin: from,
      "content-type": "multipart/form-data; boundary=x",
    },
    body: "x",
  });
  mocks.forms.set(request, form);
  return request;
}
const uploadRequest = formRequest;
const params = <T>(value: T) => ({ params: Promise.resolve(value) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", origin);
});

describe("contract file upload", () => {
  const form = (kind = "main", file: File = pdf) => {
    const data = new FormData();
    data.set("kind", kind);
    data.set("file", file);
    return data;
  };

  it("refuses requests from another site before reading a session", async () => {
    as("revenue");
    const response = await upload(
      uploadRequest(form(), "https://evil.example"),
      params({ id: contractId }),
    );
    expect(response.status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("refuses a role without contract:write", async () => {
    as("finance_approver");
    const response = await upload(
      uploadRequest(form()),
      params({ id: contractId }),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "CONTRACT_FORBIDDEN",
    });
    expect(mocks.repository.addFile).not.toHaveBeenCalled();
  });

  it("stores the PDF for a seller and refuses kinds staff may not upload", async () => {
    as("revenue");
    mocks.repository.addFile.mockResolvedValue({ id: fileId });
    const response = await upload(
      uploadRequest(form()),
      params({ id: contractId }),
    );
    expect(response.status).toBe(200);
    const [, upload1] = mocks.repository.addFile.mock.calls[0] as [
      string,
      { kind: string; fileName: string; bytes: Uint8Array },
    ];
    expect(upload1).toMatchObject({ kind: "main", fileName: "Signed MSA.pdf" });
    expect(Buffer.from(upload1.bytes).toString()).toContain("%PDF-1.7");
    const executed = await upload(
      uploadRequest(form("executed")),
      params({ id: contractId }),
    );
    expect(executed.status).toBe(422);
  });

  it("refuses a body over the limit from its declared length", async () => {
    as("revenue");
    const request = new Request(`${origin}/x`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(27 * 1024 * 1024),
      },
      body: "x",
    });
    const response = await upload(request, params({ id: contractId }));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: "DOCUMENT_TOO_LARGE",
    });
  });
});

describe("downloads", () => {
  it("serves a verified PDF with a safe file name to readers only", async () => {
    as("revenue");
    mocks.repository.readFile.mockResolvedValue({
      file: {
        id: fileId,
        kind: "executed",
        fileName: "Contrato firmado — Señal",
      },
      bytes: Buffer.from("%PDF-1.7"),
    });
    const response = await download(
      new Request(`${origin}/x`),
      params({ id: contractId, fileId }),
    );
    expect(mocks.repository.recordAccess).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "019a44ac-0000-7000-8000-0000000000aa" }),
      { kind: "file", contractId, fileId, fileKind: "executed" },
    );
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-security-policy")).toBe("sandbox");
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("content-disposition")).toBe(
      contentDisposition("Contrato firmado — Señal"),
    );
    as("destructive_action_approver");
    const denied = await download(
      new Request(`${origin}/x`),
      params({ id: contractId, fileId }),
    );
    expect(denied.status).toBe(403);
    expect(mocks.repository.recordAccess).toHaveBeenCalledOnce();
  });

  it("serves nothing when the download cannot be audited", async () => {
    as("revenue");
    mocks.repository.readFile.mockResolvedValue({
      file: { id: fileId, kind: "main", fileName: "Signed MSA" },
      bytes: Buffer.from("%PDF-1.7"),
    });
    mocks.repository.recordAccess.mockRejectedValueOnce(new Error("db down"));
    const response = await download(
      new Request(`${origin}/x`),
      params({ id: contractId, fileId }),
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).not.toBe("application/pdf");
  });

  it("reports a document that fails its hash check without its bytes", async () => {
    as("revenue");
    mocks.repository.readFile.mockRejectedValue(
      new Error("DOCUMENT_INTEGRITY"),
    );
    const response = await download(
      new Request(`${origin}/x`),
      params({ id: contractId, fileId }),
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "DOCUMENT_INTEGRITY",
    });
  });

  it("names files for people and for every browser", () => {
    expect(contentDisposition("Bluefin MSA")).toBe(
      `attachment; filename="Bluefin MSA.pdf"; filename*=UTF-8''Bluefin%20MSA.pdf`,
    );
    expect(contentDisposition('x".pdf', "inline")).toMatch(
      /^inline; filename="x.pdf"/,
    );
  });
});

describe("register export", () => {
  it("exports the filtered register as CSV that cannot run formulas", async () => {
    as("revenue");
    mocks.repository.exportRows.mockResolvedValue({
      truncated: true,
      rows: [
        {
          id: contractId,
          source: "register",
          counterpartyName: '=HYPERLINK("http://x")',
          title: "",
          contractType: "dpa",
          paper: "theirs",
          status: "executed",
          effectiveDate: "2026-01-01",
          autoRenew: true,
          noticePeriodDays: 30,
          ownerName: "R.W., Holleman",
          tags: ["eu", "priority"],
          documentCount: 2,
          updatedAt: "2026-10-01T00:00:00.000Z",
          termEndDate: "2026-12-31",
          renewalDate: "2027-01-01",
          noticeDeadline: "2026-12-01",
          signingState: null,
        },
        {
          id: fileId,
          source: "mnda",
          counterpartyName: "Signal Labs",
          title: "",
          contractType: "mnda",
          paper: "ours",
          status: "executed",
          effectiveDate: "2026-02-01",
          autoRenew: false,
          noticePeriodDays: null,
          ownerName: "Seller",
          tags: [],
          documentCount: 1,
          updatedAt: "2026-10-01T00:00:00.000Z",
          termEndDate: null,
          renewalDate: null,
          noticeDeadline: null,
          signingState: null,
        },
      ],
    });
    const response = await exportCsv(
      new Request(`${origin}/internal/contracts/export?type=dpa&q=blue`),
    );
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("x-contract-export-truncated")).toBe("true");
    const csv = await response.text();
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain(`"R.W., Holleman"`);
    expect(csv).toContain("Data processing addendum");
    expect(mocks.repository.exportRows).toHaveBeenCalledWith(
      expect.objectContaining({ type: "dpa", q: "blue" }),
      expect.any(String),
      { includeMndas: true },
    );
    // Audited once, with the MNDAs it carries counted on their own.
    expect(mocks.repository.recordAccess).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "019a44ac-0000-7000-8000-0000000000aa" }),
      expect.objectContaining({
        kind: "export",
        rows: 2,
        mndaRows: 1,
        truncated: true,
      }),
    );
    const audited = mocks.repository.recordAccess.mock.calls[0]?.[1] as
      { filters: { type: string; q: string } } | undefined;
    expect(audited?.filters).toMatchObject({ type: "dpa", q: "blue" });
  });

  it("refuses roles without contract:read", async () => {
    as("destructive_action_approver");
    const response = await exportCsv(new Request(`${origin}/x`));
    expect(response.status).toBe(403);
    expect(mocks.repository.recordAccess).not.toHaveBeenCalled();
  });
});

describe("sales library files", () => {
  it("lets only collateral managers add PDFs, and sales readers download them", async () => {
    const form = new FormData();
    form.set("item", JSON.stringify({ id: contractId }));
    form.set("file", pdf);
    as("revenue");
    const denied = await addCollateral(formRequest(form));
    expect(denied.status).toBe(403);
    expect(mocks.library.create).not.toHaveBeenCalled();
    as("commerce_admin");
    mocks.library.create.mockResolvedValue({ id: contractId });
    const added = await addCollateral(formRequest(form));
    expect(added.status).toBe(200);
    as("revenue");
    mocks.library.readFile.mockResolvedValue({
      record: { title: "Deck", file: { fileName: "Deck.pdf" } },
      bytes: Buffer.from("%PDF-1.7"),
    });
    const file = await collateralFile(
      new Request(`${origin}/x`),
      params({ id: contractId }),
    );
    expect(file.status).toBe(200);
    expect(mocks.library.recordDownload).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "019a44ac-0000-7000-8000-0000000000aa" }),
      contractId,
    );
  });
});
