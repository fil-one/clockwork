import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defaultSlackNotificationKinds,
  type StaffNotification,
} from "@clockwork/contracts";

const mocks = vi.hoisted(() => ({
  markRead: vi.fn(),
  markAll: vi.fn(),
  savePreferences: vi.fn(),
  saveSettings: vi.fn(),
  sendTest: vi.fn(),
}));
vi.mock("./actions", () => ({
  markNotificationsRead: mocks.markRead,
  markAllNotificationsRead: mocks.markAll,
  saveNotificationPreferences: mocks.savePreferences,
  saveNotificationSettings: mocks.saveSettings,
  sendNotificationTest: mocks.sendTest,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/internal",
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { NotificationBell, notificationsChangedEvent } from "./bell";
import { NotificationInbox } from "./notification-inbox";
import type {
  NotificationInboxData,
  NotificationSettingsData,
} from "./page-data";
import { NotificationSettingsWorkspace } from "./settings-workspace";

const notification = (
  patch: Partial<StaffNotification> = {},
): StaffNotification => ({
  id: "62000000-0000-4000-8000-000000000001",
  kind: "mnda.counterparty_signed",
  recordType: "mnda",
  recordId: "61000000-0000-4000-8000-000000000001",
  href: "/internal/mndas?q=Larkspur",
  subject: "Larkspur Genomics, Inc.",
  actorName: null,
  detail: null,
  createdAt: "2026-10-10T12:00:00.000Z",
  readAt: null,
  ...patch,
});

const inbox = (
  patch: Partial<NotificationInboxData> = {},
): NotificationInboxData => ({
  page: {
    notifications: [
      notification(),
      notification({
        id: "62000000-0000-4000-8000-000000000002",
        kind: "contract.sent_back",
        recordType: "contract",
        href: "/internal/contracts/c1",
        subject: "Tidewater Media Group LLC",
        actorName: "Imani Ross",
        detail: "Use the 2026 DPA",
      }),
      notification({
        id: "62000000-0000-4000-8000-000000000003",
        kind: "mnda.completed",
        subject: "Fernhill Research Institute",
        readAt: "2026-10-09T12:00:00.000Z",
      }),
    ],
    unread: 2,
    more: false,
  },
  preferences: { emailEnabled: true, emailMutedKinds: [] },
  kinds: ["mnda.counterparty_signed", "mnda.completed", "contract.sent_back"],
  email: "priya@fil.one",
  emailActive: true,
  canManage: false,
  demo: false,
  ...patch,
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("the notification bell", () => {
  it("shows the unread count and links to the inbox", async () => {
    const fetch = vi.fn(() => Promise.resolve(Response.json({ unread: 3 })));
    vi.stubGlobal("fetch", fetch);
    render(<NotificationBell />);
    const bell = await screen.findByRole("link", {
      name: "Notifications, 3 unread",
    });
    expect(bell).toHaveAttribute("href", "/internal/notifications");
    expect(bell).toHaveTextContent("3");
    expect(fetch).toHaveBeenCalledWith(
      "/internal/notifications/unread",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("shows no number when the count cannot be read, and catches up when the inbox changes", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValue(Response.json({ unread: 1 }));
    vi.stubGlobal("fetch", fetch);
    render(<NotificationBell />);
    expect(
      await screen.findByRole("link", { name: "Notifications" }),
    ).not.toHaveTextContent(/\d/u);
    window.dispatchEvent(new Event(notificationsChangedEvent));
    expect(
      await screen.findByRole("link", { name: "Notifications, 1 unread" }),
    ).toBeInTheDocument();
  });
});

describe("the inbox", () => {
  it("lists notifications as sentences with their notes and links", () => {
    render(<NotificationInbox initial={inbox()} />);
    expect(
      screen.getByRole("heading", { name: "2 unread" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Larkspur Genomics, Inc. signed the MNDA. It is waiting for the Fil One countersignature.",
      }),
    ).toHaveAttribute("href", "/internal/mndas?q=Larkspur");
    expect(
      screen.getByRole("link", {
        name: "Imani Ross sent the contract with Tidewater Media Group LLC back.",
      }),
    ).toHaveAttribute("href", "/internal/contracts/c1");
    expect(screen.getByText("Note: Use the 2026 DPA")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Notification settings" }),
    ).toBeNull();
  });

  it("marks one read, then all, and tells the bell", async () => {
    mocks.markRead.mockResolvedValue({ ok: true, value: { marked: 1 } });
    mocks.markAll.mockResolvedValue({ ok: true, value: { marked: 1 } });
    const changed = vi.fn();
    window.addEventListener(notificationsChangedEvent, changed);
    render(<NotificationInbox initial={inbox()} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Mark read: Larkspur Genomics, Inc.",
      }),
    );
    await waitFor(() =>
      expect(mocks.markRead).toHaveBeenCalledWith({
        ids: ["62000000-0000-4000-8000-000000000001"],
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "1 unread" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(
      await screen.findByRole("heading", { name: "0 unread" }),
    ).toBeInTheDocument();
    expect(mocks.markAll).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledTimes(2);
    window.removeEventListener(notificationsChangedEvent, changed);
  });

  it("saves the reader's email choices", async () => {
    mocks.savePreferences.mockImplementation((value: unknown) =>
      Promise.resolve({ ok: true, value }),
    );
    render(<NotificationInbox initial={inbox()} />);
    fireEvent.click(screen.getByLabelText("MNDA fully signed"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.savePreferences).toHaveBeenCalledWith({
        emailEnabled: true,
        emailMutedKinds: ["mnda.completed"],
      }),
    );
    expect(
      await screen.findByText("Email preferences saved."),
    ).toBeInTheDocument();
  });

  it("says when Commerce is not sending email yet, and is read-only in the demo", () => {
    render(
      <NotificationInbox initial={inbox({ emailActive: false, demo: true })} />,
    );
    expect(
      screen.getByText(
        "These notifications are examples. Nothing in the demo sends email or Slack messages.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

const settingsData = (
  patch: Partial<NotificationSettingsData> = {},
): NotificationSettingsData => ({
  settings: {
    emailEnabled: false,
    slackEnabled: true,
    emailDisabledKinds: [],
    slackKinds: [...defaultSlackNotificationKinds],
    slackChannelLabel: "#revenue",
    version: 3,
    updatedAt: "2026-10-01T12:00:00.000Z",
    updatedBy: null,
  },
  channels: {
    email: { state: "configured", target: "notifications@clockwork.fil.one" },
    slack: { state: "not_configured" },
  },
  recent: [
    {
      channel: "slack",
      kind: "mnda.completed",
      status: "skipped",
      reason: "not_configured",
      attempts: 1,
      providerCode: null,
      updatedAt: "2026-10-10T12:00:00.000Z",
    },
  ],
  adminEmail: "elena@fil.one",
  demo: false,
  ...patch,
});

describe("notification settings", () => {
  it("shows which channels are configured and warns about one that is on without its secret", () => {
    render(<NotificationSettingsWorkspace initial={settingsData()} />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    expect(
      screen.getByText("Sent from notifications@clockwork.fil.one."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This channel is on but not configured, so nothing is sent until the deployment supplies it.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Skipped (not configured)")).toBeInTheDocument();
  });

  it("saves the administrator's changes against the version read", async () => {
    mocks.saveSettings.mockImplementation((value: object) =>
      Promise.resolve({
        ok: true,
        value: {
          ...value,
          version: 4,
          updatedAt: "2026-10-10T13:00:00.000Z",
          updatedBy: null,
        },
      }),
    );
    render(<NotificationSettingsWorkspace initial={settingsData()} />);
    fireEvent.click(screen.getByLabelText("Send notifications by email"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledOnce());
    expect(mocks.saveSettings.mock.calls[0]?.[0]).toMatchObject({
      emailEnabled: true,
      slackEnabled: true,
      slackChannelLabel: "#revenue",
    });
    expect(mocks.saveSettings.mock.calls[0]?.[1]).toBe(3);
    expect(
      await screen.findByText("Notification settings saved."),
    ).toBeInTheDocument();
  });

  it("sends a test email to the administrator", async () => {
    mocks.sendTest.mockResolvedValue({ ok: true, value: { delivered: true } });
    render(<NotificationSettingsWorkspace initial={settingsData()} />);
    fireEvent.click(screen.getByRole("button", { name: "Send a test" }));
    await waitFor(() => expect(mocks.sendTest).toHaveBeenCalledWith("email"));
    expect(
      await screen.findByText("Test email sent to elena@fil.one."),
    ).toBeInTheDocument();
  });
});
