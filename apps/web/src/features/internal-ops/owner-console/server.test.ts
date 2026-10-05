import { beforeEach, expect, it, vi } from "vitest";

import { permissionsForRoles } from "@clockwork/contracts";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  database: vi.fn(),
  notices: vi.fn(),
  events: vi.fn(),
  assisted: vi.fn(),
  approvals: vi.fn(),
  capabilities: vi.fn(),
  staff: vi.fn(),
  selfApprovals: vi.fn(),
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
    selfApprovals = mocks.selfApprovals;
  },
  DatabaseSystemCapabilityAdmin: class {
    list = mocks.capabilities;
  },
  StaffTeamRepository: class {
    list = mocks.staff;
  },
}));

import {
  consoleEventView,
  loadOwnerConsole,
  selfApprovalTarget,
} from "./server";

const session = {
  userId: "20000000-0000-4000-8000-000000000001",
  organizationId: "30000000-0000-4000-8000-000000000008",
  providerBacked: true,
  roles: ["commerce_admin"],
  permissions: permissionsForRoles(["commerce_admin"], { side: "fil_one" }),
  mfaVerified: true,
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
      target: {
        id: "70000000-0000-4000-8000-000000000001",
        version: 4,
        date: null,
      },
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
      target: null,
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
  mocks.selfApprovals.mockResolvedValue([
    {
      id: "50000000-0000-4000-8000-000000000009",
      occurredAt: new Date("2026-10-03T09:00:00Z"),
      actor: { userId: "a", name: "R.W. Holleman", email: "rw@fil.one" },
      control: "payg_offer",
      name: "S3-STD",
      version: 2,
      detail: "eu-central",
      reason: "Launch day",
    },
  ]);
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
        selfApproval: {
          id: "70000000-0000-4000-8000-000000000001",
          version: 4,
        },
      },
      expect.objectContaining({
        control: "termination",
        requestedBy: null,
        href: null,
        ownRequest: false,
        selfApproval: null,
      }),
    ],
  });
  expect(view.selfApprovals).toEqual({
    state: "ready",
    items: [
      {
        id: "50000000-0000-4000-8000-000000000009",
        at: "2026-10-03T09:00:00.000Z",
        actor: { name: "R.W. Holleman", email: "rw@fil.one" },
        control: "payg_offer",
        name: "S3-STD",
        version: 2,
        detail: "eu-central",
        reason: "Launch day",
      },
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

it("offers no self-approval in an assisted session or without approval:self", async () => {
  mocks.session.mockResolvedValue({
    ...session,
    roles: ["internal_operator"],
    permissions: permissionsForRoles(["internal_operator"], {
      side: "fil_one",
    }),
  });
  const view = await loadOwnerConsole(new Date("2026-10-04T16:00:00Z"));
  expect(view.approvals.items.map((item) => item.selfApproval)).toEqual([
    null,
    null,
  ]);
  mocks.session.mockResolvedValue({
    ...session,
    impersonation: { accountId: "10000000-0000-4000-8000-000000000001" },
  });
  const assisted = await loadOwnerConsole(new Date("2026-10-04T16:00:00Z"));
  expect(assisted.approvals.items[0]?.selfApproval).toBeNull();
});

it("activates a price book in effect and schedules one that starts later", () => {
  const pending = (date: string | null) => ({
    control: "price_book_activation" as const,
    target: { id: "book", version: 7, date },
  });
  expect(selfApprovalTarget(pending("2026-10-04"), "2026-10-04")).toEqual({
    id: "book",
    version: 7,
    priceBookAction: "activate",
  });
  expect(selfApprovalTarget(pending("2026-11-01"), "2026-10-04")).toEqual({
    id: "book",
    version: 7,
    priceBookAction: "schedule_activation",
  });
  expect(selfApprovalTarget(pending(null), "2026-10-04")).toBeNull();
  expect(
    selfApprovalTarget({ control: "termination", target: null }, "2026-10-04"),
  ).toBeNull();
});

it("words a self-approval event by its control, with its reason", () => {
  expect(
    consoleEventView({
      ...granted,
      eventType: "approval.self_approved",
      before: null,
      after: {
        control: "termination_teardown",
        reason: "Customer asked twice",
      },
    }),
  ).toMatchObject({
    type: "approval.self_approved",
    subject: null,
    control: "termination",
    reason: "Customer asked twice",
  });
});
