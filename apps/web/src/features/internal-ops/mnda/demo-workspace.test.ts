import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  repository: vi.fn(),
  signWell: vi.fn(),
  render: vi.fn(),
}));
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.session,
  getRequestCommerceSession: mocks.session,
  explicitDemoIdentityEnabled: () => true,
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: vi.fn() }));
vi.mock("@/src/i18n/server", async () => {
  const { translatorFor } = await import("@/src/i18n/catalogs");
  return { getTranslations: () => Promise.resolve(translatorFor("en")) };
});
vi.mock("@clockwork/db", () => ({ MndaRepository: mocks.repository }));
vi.mock("@clockwork/integrations", () => ({ SignWellClient: mocks.signWell }));
vi.mock("@clockwork/documents", () => ({
  mndaTemplateHash: "b".repeat(64),
  renderMnda: mocks.render,
}));
import {
  loadMndaRegister,
  loadMndas,
  operateMnda,
  prepareMnda,
} from "./actions";
import { loadMndaPage } from "./page-data";
import { GET as exportCsv } from "../../../../app/(experience)/(internal)/internal/mndas/export/route";
import { GET as pdf } from "../../../../app/(experience)/(internal)/internal/mndas/[id]/pdf/route";

const seller = {
  userId: "21000000-0000-4000-8000-000000000010",
  profile: { name: "Priya Raman", email: "priya.raman@fil-one-internal.test" },
  roles: ["revenue"],
  permissions: ["mnda:send", "contract:read", "sales:read"],
  isInternalStaff: true,
  mfaVerified: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(seller);
  mocks.render.mockResolvedValue({ bytes: Buffer.from("%PDF-demo") });
});

it("reads the fictional register without the database or SignWell", async () => {
  const result = await loadMndas({ status: [], mine: false, q: "", page: 1 });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value).toMatchObject({
    demo: true,
    ready: false,
    canManage: false,
    viewerId: seller.userId,
  });
  const states = new Set(result.value.register.records.map((r) => r.state));
  for (const state of [
    "draft",
    "sent",
    "viewed",
    "awaiting_countersignature",
    "completed",
    "attention",
    "canceled",
  ])
    expect(states).toContain(state);
  // Days outstanding count from the read, not from a fixed seed date.
  const sent = result.value.register.records.find((r) => r.state === "sent");
  expect(Date.now() - Date.parse(sent?.sentAt ?? "")).toBeLessThan(
    20 * 86_400_000,
  );
  expect(mocks.repository).not.toHaveBeenCalled();
  expect(mocks.signWell).not.toHaveBeenCalled();
});

it("serves the page's first load and its quiet refresh from the demo", async () => {
  const page = await loadMndaPage({});
  expect(page).toMatchObject({ ok: true, value: { demo: true } });
  const refresh = await loadMndaRegister({});
  expect(refresh.ok && Object.keys(refresh.value)).toEqual(["register"]);
  expect(mocks.repository).not.toHaveBeenCalled();
});

it("filters the demo register the way the repository does", async () => {
  const mine = await loadMndas({ status: [], mine: true, q: "", page: 1 });
  const search = await loadMndas({ status: [], q: "kestrel", page: 1 });
  expect(
    mine.ok &&
      mine.value.register.records.every((r) => r.ownerId === seller.userId),
  ).toBe(true);
  expect(
    search.ok && search.value.register.records.map((r) => r.input.company),
  ).toEqual(["Kestrel Bio SAS"]);
  // What a partner entered at signing is searched, as in the repository.
  const entered = await loadMndas({ status: [], q: "colorado", page: 1 });
  expect(
    entered.ok &&
      entered.value.register.records.map((r) => [
        r.input.company,
        r.input.entityDescription,
        r.partnerDetails,
      ]),
  ).toEqual([
    [
      "Pinecrest Mapping Co.",
      "",
      { entity: "Colorado corporation", signer_title: "Founder" },
    ],
  ]);
});

it("refuses every change in the demo with its own code", async () => {
  await expect(prepareMnda({ input: {} })).resolves.toEqual({
    ok: false,
    code: "demo_unavailable",
  });
  await expect(
    operateMnda({
      id: "61000000-0000-4000-8000-000000000002",
      operation: "remind",
    }),
  ).resolves.toEqual({ ok: false, code: "demo_unavailable" });
  expect(mocks.repository).not.toHaveBeenCalled();
  expect(mocks.signWell).not.toHaveBeenCalled();
});

it("refuses a demo persona without MNDA access", async () => {
  mocks.session.mockResolvedValue({
    ...seller,
    roles: ["owner"],
    permissions: [],
    isInternalStaff: false,
  });
  await expect(loadMndas()).resolves.toEqual({ ok: false, code: "forbidden" });
  const response = await exportCsv(
    new Request("https://commerce.test/internal/mndas/export"),
  );
  expect(response.status).toBe(403);
});

it("exports the demo register and renders demo agreements unsigned", async () => {
  const csv = await exportCsv(
    new Request("https://commerce.test/internal/mndas/export?status=completed"),
  );
  expect(csv.status).toBe(200);
  const text = await csv.text();
  expect(text).toContain("Fernhill Research Institute");
  expect(text).not.toContain("Tidewater");

  const response = await pdf(
    new Request(
      "https://commerce.test/internal/mndas/61000000-0000-4000-8000-000000000005/pdf?kind=executed&download=1",
    ),
    { params: Promise.resolve({ id: "61000000-0000-4000-8000-000000000005" }) },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  // Nothing was signed in the demo, so the file is named as a draft.
  expect(response.headers.get("content-disposition")).toContain("_draft.pdf");
  // Opening the same agreement again reuses the first rendering.
  const again = await pdf(
    new Request(
      "https://commerce.test/internal/mndas/61000000-0000-4000-8000-000000000005/pdf",
    ),
    { params: Promise.resolve({ id: "61000000-0000-4000-8000-000000000005" }) },
  );
  expect(again.status).toBe(200);
  expect(mocks.render).toHaveBeenCalledTimes(1);

  const missing = await pdf(
    new Request(
      "https://commerce.test/internal/mndas/019a44ac-0000-7000-8000-000000000099/pdf",
    ),
    { params: Promise.resolve({ id: "019a44ac-0000-7000-8000-000000000099" }) },
  );
  expect(missing.status).toBe(404);
  expect(mocks.repository).not.toHaveBeenCalled();
});
