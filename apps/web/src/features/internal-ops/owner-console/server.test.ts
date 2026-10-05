import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  database: vi.fn(),
  notices: vi.fn(),
  events: vi.fn(),
  assisted: vi.fn(),
  approvals: vi.fn(),
  capabilities: vi.fn(),
  staff: vi.fn(),
}));
vi.mock("@/src/auth/session", () => ({ getCommerceSession: mocks.session }));
vi.mock("@/src/db/service", () => ({
  getOptionalServiceDatabase: mocks.database,
}));
vi.mock("@clockwork/db", () => ({
  pendingApprovalControls: ["exception_case", "termination", "channel_policy"],
  OwnerConsoleRepository: class {
    unreadNotices = mocks.notices;
    securityEvents = mocks.events;
    openAssistedSessions = mocks.assisted;
    pendingApprovals = mocks.approvals;
  },
  DatabaseSystemCapabilityAdmin: class {
    list = mocks.capabilities;
  },
  StaffTeamRepository: class {
    list = mocks.staff;
  },
}));

import { loadOwnerConsole } from "./server";

const session = {
  userId: "20000000-0000-4000-8000-000000000001",
  organizationId: "30000000-0000-4000-8000-000000000008",
  providerBacked: true,
};
const granted = {
  id: "50000000-0000-4000-8000-000000000001",
  eventType: "staff.role_granted",
  occurredAt: new Date("2026-10-04T15:20:00Z"),
  actor: { userId: "a", name: "R.W. Holleman", email: "rw@fil.one" },
  accountName: null,
  before: { email: "sam@fil.one", roles: ["revenue"] },
  after: {
    email: "sam@fil.one",
    role: "legal_approver",
    roles: ["revenue", "legal_approver"],
    reason: "Contract reviews",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(session);
  mocks.database.mockReturnValue({});
  mocks.notices.mockResolvedValue([
    { noticeId: "60000000-0000-4000-8000-000000000001", ...granted },
  ]);
  mocks.events.mockResolvedValue([
    granted,
    {
      ...granted,
      id: "50000000-0000-4000-8000-000000000002",
      eventType: "mnda.settings_changed",
      before: { noticeEmail: "james@fil.one" },
      after: { noticeEmail: "legal@fil.one" },
    },
    {
      ...granted,
      id: "50000000-0000-4000-8000-000000000003",
      eventType: "workflow.report_exported",
      actor: null,
      after: { reportType: "revenue" },
    },
  ]);
  mocks.assisted.mockResolvedValue([]);
  const pending = [
    {
      control: "exception_case",
      id: "70000000-0000-4000-8000-000000000001",
      name: "Meridian Archive",
      version: null,
      detail: "legal",
      requestedBy: { userId: session.userId, name: "Noor", email: "n@fil.one" },
      requestedAt: new Date("2026-10-01T12:00:00Z"),
      href: "/internal/queues/queue-legal-meridian",
    },
    {
      control: "termination",
      id: "70000000-0000-4000-8000-000000000002",
      name: "Cobalt Orchard Media",
      version: null,
      detail: null,
      requestedBy: null,
      requestedAt: new Date("2026-10-02T12:00:00Z"),
      href: null,
    },
  ];
  mocks.approvals.mockImplementation(({ control }: { control: string }) =>
    Promise.resolve(pending.filter((item) => item.control === control)),
  );
  mocks.capabilities.mockResolvedValue([
    {
      capabilityKey: "billing",
      enabled: false,
      recoveryEnabled: true,
      pending: null,
    },
  ]);
  mocks.staff.mockResolvedValue([]);
});

it("reads the viewer's own notices and words what each event was about", async () => {
  const view = await loadOwnerConsole(new Date("2026-10-04T16:00:00Z"));
  expect(mocks.notices).toHaveBeenCalledWith(
    expect.objectContaining({ viewerUserId: session.userId }),
  );
  expect(view.mode).toBe("live");
  expect(view.notices).toEqual({
    state: "ready",
    items: [
      {
        noticeId: "60000000-0000-4000-8000-000000000001",
        id: granted.id,
        type: "staff.role_granted",
        at: "2026-10-04T15:20:00.000Z",
        actor: { name: "R.W. Holleman", email: "rw@fil.one" },
        subject: "sam@fil.one",
        role: "legal_approver",
        reason: "Contract reviews",
      },
    ],
  });
  expect(view.securityEvents).toMatchObject({
    state: "ready",
    items: [
      { subject: "sam@fil.one" },
      { type: "mnda.settings_changed", subject: "legal@fil.one", role: null },
      { type: "workflow.report_exported", actor: null },
    ],
  });
  expect(view.capabilities).toEqual({
    state: "ready",
    items: [
      { key: "billing", enabled: false, recoveryEnabled: true, pending: false },
    ],
  });
  expect(view.approvals).toEqual({
    unavailable: [],
    items: [
      {
        id: "70000000-0000-4000-8000-000000000001",
        control: "exception_case",
        name: "Meridian Archive",
        version: null,
        detail: "legal",
        requestedBy: "Noor",
        requestedAt: "2026-10-01T12:00:00.000Z",
        href: "/internal/queues/queue-legal-meridian",
        ownRequest: true,
      },
      expect.objectContaining({
        control: "termination",
        requestedBy: null,
        href: null,
        ownRequest: false,
      }),
    ],
  });
  expect(mocks.events).toHaveBeenCalledTimes(1);
  expect(mocks.assisted).toHaveBeenCalledWith(
    expect.objectContaining({ now: new Date("2026-10-04T16:00:00Z") }),
  );
});

it("reads each control's requests on its own and names a control that failed", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.approvals.mockImplementation(({ control }: { control: string }) =>
    control === "channel_policy"
      ? Promise.reject(new Error("relation does not exist"))
      : Promise.resolve([]),
  );
  const view = await loadOwnerConsole();
  expect(mocks.approvals).toHaveBeenCalledTimes(3);
  expect(view.approvals).toEqual({
    items: [],
    unavailable: ["channel_policy"],
  });
});

it("keeps the rest of the page when one section cannot be read", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.capabilities.mockRejectedValueOnce(new Error("connection refused"));
  const view = await loadOwnerConsole();
  expect(view.capabilities).toEqual({ state: "unavailable" });
  expect(view.notices.state).toBe("ready");
  expect(view.staff.state).toBe("ready");
});

it("shows sample records, not a database, in the demo", async () => {
  mocks.session.mockResolvedValue({ ...session, providerBacked: false });
  const view = await loadOwnerConsole();
  expect(view.mode).toBe("demo");
  expect(mocks.notices).not.toHaveBeenCalled();
  expect(mocks.events).not.toHaveBeenCalled();
});
