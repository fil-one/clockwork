import { ContractListQuerySchema } from "@clockwork/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  demo: vi.fn(),
  database: vi.fn(),
}));
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.session,
  getRequestCommerceSession: mocks.session,
  explicitDemoIdentityEnabled: mocks.demo,
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: mocks.database }));
import {
  loadContract,
  loadContractForm,
  loadRegister,
  loadRenewals,
} from "./loaders";
import { demoContractRegister, demoSalesLibrary } from "./demo-register";

const now = new Date("2027-03-15T10:00:00.000Z");
const today = "2027-03-15";
const query = (raw: Record<string, string> = {}) =>
  ContractListQuerySchema.parse(raw);
const viewer = {
  id: "21000000-0000-4000-8000-000000000010",
  name: "Priya Raman",
  email: "priya.raman@fil-one-internal.test",
};
const seller = {
  userId: "21000000-0000-4000-8000-000000000010",
  profile: { name: "Priya Raman", email: "priya.raman@fil-one-internal.test" },
  roles: ["revenue"],
  permissions: ["mnda:send", "contract:read", "contract:write", "sales:read"],
  isInternalStaff: true,
  mfaVerified: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.demo.mockReturnValue(true);
  mocks.session.mockResolvedValue(seller);
});

describe("demo contract register", () => {
  it("places renewal and notice deadlines relative to the day it is read", async () => {
    const register = demoContractRegister(now, viewer);
    const due = await register.renewalsDue(today, 30);
    expect(
      due.map((row) => [row.counterpartyName, row.noticeDeadline]),
    ).toEqual([
      ["Fernhill Research Institute", "2027-03-30"],
      ["Orchard Street Studios Inc.", "2027-04-04"],
    ]);
    const passed = await register.noticesPassed(today);
    expect(passed.map((row) => row.counterpartyName)).toEqual([
      "Brightwater Systems Integrators Ltd",
    ]);
    await expect(register.renewalSummary(today)).resolves.toEqual({
      within30: 2,
      within60: 2,
      within90: 2,
      passed: 1,
      nextDeadline: "2027-03-30",
    });
  });

  it("filters, sorts and pages like the repository and joins signed MNDAs", async () => {
    const register = demoContractRegister(now, viewer);
    const all = await register.list(query(), today, {
      includeMndas: true,
      viewerId: viewer.id,
    });
    const withoutMndas = await register.list(query(), today, {
      includeMndas: false,
      viewerId: viewer.id,
    });
    expect(all.total).toBe(withoutMndas.total + 3);
    // The reader's own signed MNDA carries the reader's name, never a blank.
    const mndaOwners = all.rows
      .filter((row) => row.source === "mnda")
      .map((row) => row.ownerName);
    expect(mndaOwners).toContain("Priya Raman");
    expect(mndaOwners.every(Boolean)).toBe(true);
    expect(all.rows[0]?.updatedAt).toBe(
      [...all.rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
        ?.updatedAt,
    );
    const negotiating = await register.list(
      query({ status: "in_negotiation" }),
      today,
      { includeMndas: true, viewerId: viewer.id },
    );
    expect(negotiating.rows.map((row) => row.counterpartyName)).toEqual([
      "Halden Archives AS",
    ]);
    const search = await register.list(query({ q: "pilot" }), today, {
      includeMndas: false,
      viewerId: viewer.id,
    });
    expect(search.rows.map((row) => row.title)).toEqual(["Pilot order form"]);
    const byNotice = await register.list(query({ sort: "notice" }), today, {
      includeMndas: false,
      viewerId: viewer.id,
    });
    expect(byNotice.rows[0]?.counterpartyName).toBe(
      "Brightwater Systems Integrators Ltd",
    );
    expect(byNotice.rows.at(-1)?.noticeDeadline).toBeNull();
  });

  it("narrows to what the reader recorded, whoever the owner is, and the MNDAs they sent", async () => {
    const register = demoContractRegister(now, viewer);
    const scope = { includeMndas: true, viewerId: viewer.id };
    const mine = await register.list(query({ mine: "1" }), today, scope);
    expect(mine.rows.some((row) => row.source === "mnda")).toBe(true);
    // Every contract listed was recorded by the reader, judged by its
    // creator rather than the free-text owner.
    const contracts = mine.rows.filter((row) => row.source === "register");
    for (const row of contracts)
      expect((await register.get(row.id, today)).contract.createdByName).toBe(
        "Priya Raman",
      );
    // Recorded by the reader for a colleague: listed under the reader.
    expect(
      contracts.find((row) => row.counterpartyName === "Pinecrest Mapping Co."),
    ).toMatchObject({ ownerName: "Jonah Pike" });
    const exported = await register.exportRows(
      query({ mine: "1" }),
      today,
      scope,
    );
    expect(exported.rows).toHaveLength(mine.total);
    // The owner named on the contract does not see it as theirs; they see
    // what they recorded, here their own Pinecrest MNDA.
    const jonah = await register.list(query({ mine: "1" }), today, {
      ...scope,
      viewerId: "61000000-0000-4000-8000-000000000101",
    });
    expect(jonah.total).toBeGreaterThan(0);
    expect(
      jonah.rows
        .filter((row) => row.counterpartyName === "Pinecrest Mapping Co.")
        .map((row) => row.source),
    ).toEqual(["mnda"]);
    const someoneElse = await register.list(query({ mine: "1" }), today, {
      ...scope,
      viewerId: "21000000-0000-4000-8000-000000000099",
    });
    expect(someoneElse.total).toBe(0);
  });

  it("opens a record with its history and reports an unknown one missing", async () => {
    const register = demoContractRegister(now, viewer);
    const detail = await register.get(
      "62000000-0000-4000-8000-000000000001",
      today,
    );
    expect(detail.contract).toMatchObject({
      counterpartyName: "Fernhill Research Institute",
      status: "executed",
      renewalDate: "2027-05-30",
    });
    expect(detail.activity.map((event) => event.eventType)).toEqual([
      "contract.updated",
      "contract.created",
    ]);
    await expect(
      register.get("62000000-0000-4000-8000-000000000099", today),
    ).rejects.toThrow("CONTRACT_NOT_FOUND");
  });

  it("shows Fil One's own PDFs out for signature, one sent again after a void", async () => {
    const register = demoContractRegister(now, viewer);
    const sent = await register.get(
      "62000000-0000-4000-8000-000000000011",
      today,
    );
    expect(sent.contract).toMatchObject({
      counterpartyName: "Larkspur Data Cooperative",
      paper: "ours",
      status: "out_for_signature",
    });
    expect(sent.signing).toMatchObject({
      documentType: "counterparty_paper",
      counterpartySigns: true,
      requestNumber: 1,
      state: "viewed",
    });
    expect(sent.previousSigning).toEqual([]);
    const again = await register.get(
      "62000000-0000-4000-8000-000000000012",
      today,
    );
    expect(again.signing).toMatchObject({ requestNumber: 2, state: "sent" });
    expect(again.previousSigning).toEqual([
      expect.objectContaining({
        requestNumber: 1,
        state: "canceled",
        cancelCode: "voided",
      }),
    ]);
    expect(again.activity.map((event) => event.eventType)).toContain(
      "contract.voided",
    );
    const rows = await register.list(
      query({ status: "out_for_signature" }),
      today,
      {
        includeMndas: false,
        viewerId: viewer.id,
      },
    );
    expect(
      rows.rows
        .filter((row) => row.signingState)
        .map((row) => [row.counterpartyName, row.signingState]),
    ).toEqual(
      expect.arrayContaining([
        ["Larkspur Data Cooperative", "viewed"],
        ["Quarry Lane Storage Partners", "sent"],
      ]),
    );
  });

  it("lists current collateral before archived items", async () => {
    const items = await demoSalesLibrary(now).list();
    expect(items.map((item) => item.status)).toEqual([
      "current",
      "current",
      "current",
      "current",
      "archived",
    ]);
  });
});

describe("demo contract loaders", () => {
  it("reads the demo register with write and approval removed", async () => {
    const loaded = await loadRegister({});
    expect(loaded).toMatchObject({
      kind: "ready",
      canWrite: false,
      canApprove: false,
      canOpenMndas: true,
    });
    expect(mocks.database).not.toHaveBeenCalled();
    await expect(
      loadContract("62000000-0000-4000-8000-000000000004"),
    ).resolves.toMatchObject({ kind: "ready", signingReady: false });
    // A PDF out for signature reads in the demo, with nothing to send.
    await expect(
      loadContract("62000000-0000-4000-8000-000000000012"),
    ).resolves.toMatchObject({
      kind: "ready",
      canWrite: false,
      paperSources: [],
      signing: { requestNumber: 2 },
    });
    await expect(loadRenewals("90")).resolves.toMatchObject({ kind: "ready" });
    expect(mocks.database).not.toHaveBeenCalled();
  });

  it("keeps recording and editing unavailable in the demo", async () => {
    await expect(loadContractForm()).resolves.toEqual({
      kind: "denied",
      code: "CONTRACT_DEMO_UNAVAILABLE",
    });
  });

  it("refuses a demo persona without contract access", async () => {
    mocks.session.mockResolvedValue({
      ...seller,
      roles: ["owner"],
      permissions: [],
      isInternalStaff: false,
    });
    await expect(loadRegister({})).resolves.toEqual({
      kind: "denied",
      code: "CONTRACT_FORBIDDEN",
    });
  });
});
