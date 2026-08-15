import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NotificationPreferencesContext } from "./notification-preferences";

const storeNotificationPreference =
  vi.fn<(input: unknown) => Promise<unknown>>();
vi.mock("./notification-preference-client", () => ({
  storeNotificationPreference: (input: unknown) =>
    storeNotificationPreference(input),
}));

const { NotificationPreferences, NotificationPreferencesUnavailable } =
  await import("./notification-preferences");

const northstar: NotificationPreferencesContext = {
  accountId: "10000000-0000-4000-8000-000000000001",
  accountName: "Northstar Archive Labs",
  canManage: true,
  stored: [],
};

const juniper: NotificationPreferencesContext = {
  accountId: "10000000-0000-4000-8000-000000000004",
  accountName: "Juniper Health Demo",
  canManage: true,
  stored: [{ alertKind: "quote_expiry", channel: "email", enabled: false }],
};

afterEach(() => {
  storeNotificationPreference.mockReset();
});

describe("what the notification preferences surface states", () => {
  it("names the acting account and nobody else's", () => {
    render(<NotificationPreferences context={northstar} />);
    expect(screen.getByRole("main")).toHaveTextContent(
      "Northstar Archive Labs",
    );
    expect(screen.getByRole("main")).not.toHaveTextContent(
      "Juniper Health Demo",
    );
  });

  it("offers a control for every manageable alert and none for the rest", () => {
    render(<NotificationPreferences context={northstar} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByLabelText(/Renewal term reminders/)).toBeChecked();
    expect(screen.getByLabelText(/Proof-of-concept milestones/)).toBeChecked();
    expect(screen.getByLabelText(/Quote expiry warnings/)).toBeChecked();
    expect(screen.queryByLabelText(/Renewal notice deadline/)).toBeNull();
    expect(
      screen.queryByLabelText(/Collections and payment demands/),
    ).toBeNull();
  });

  it("states the complete set of notices that cannot be switched off", () => {
    render(<NotificationPreferences context={northstar} />);
    const refused = screen.getByRole("region", {
      name: "Notices that cannot be switched off",
    });
    expect(refused).toHaveTextContent("Renewal notice deadline");
    expect(refused).toHaveTextContent("Collections and payment demands");
    expect(refused).toHaveTextContent("These two, and only these two");
  });

  it("shows a stored suppression as stored rather than as a default", () => {
    render(<NotificationPreferences context={juniper} />);
    expect(screen.getByLabelText(/Quote expiry warnings/)).not.toBeChecked();
    expect(screen.getByRole("main")).toHaveTextContent("Stored choice: off.");
    expect(screen.getByRole("main")).toHaveTextContent(
      "1 of 3 are currently switched off.",
    );
  });
});

describe("what the surface does when a preference is changed", () => {
  it("sends the account, the alert kind and the new state", async () => {
    const user = userEvent.setup();
    storeNotificationPreference.mockResolvedValue({
      alertKind: "quote_expiry",
      channel: "email",
      enabled: false,
    });
    render(<NotificationPreferences context={northstar} />);
    await user.click(screen.getByLabelText(/Quote expiry warnings/));
    expect(storeNotificationPreference).toHaveBeenCalledTimes(1);
    expect(storeNotificationPreference.mock.lastCall?.[0]).toEqual({
      accountId: northstar.accountId,
      alertKind: "quote_expiry",
      enabled: false,
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Quote expiry warnings will no longer be sent",
    );
    expect(screen.getByLabelText(/Quote expiry warnings/)).not.toBeChecked();
  });

  it("states what the server stored, not what was asked for", async () => {
    const user = userEvent.setup();
    storeNotificationPreference.mockResolvedValue({
      alertKind: "quote_expiry",
      channel: "email",
      enabled: true,
    });
    render(<NotificationPreferences context={juniper} />);
    await user.click(screen.getByLabelText(/Quote expiry warnings/));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Quote expiry warnings will be sent",
    );
    expect(screen.getByLabelText(/Quote expiry warnings/)).toBeChecked();
  });

  it("announces a refusal as an alert and leaves the stored value alone", async () => {
    const user = userEvent.setup();
    storeNotificationPreference.mockRejectedValue(
      new Error("collections_dunning is not an optional alert"),
    );
    render(<NotificationPreferences context={northstar} />);
    await user.click(screen.getByLabelText(/Renewal term reminders/));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "collections_dunning is not an optional alert",
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByLabelText(/Renewal term reminders/)).toBeChecked();
  });

  it("posts nothing for a role that cannot write the account", async () => {
    const user = userEvent.setup();
    render(
      <NotificationPreferences context={{ ...northstar, canManage: false }} />,
    );
    const control = screen.getByLabelText(/Quote expiry warnings/);
    expect(control).toBeDisabled();
    await user.click(control);
    expect(storeNotificationPreference).not.toHaveBeenCalled();
    expect(screen.getByRole("main")).toHaveTextContent(
      "Your role can read these settings but not change them.",
    );
  });
});

describe("what the surface states with no runtime database", () => {
  it("names the gap instead of rendering controls that post into nothing", () => {
    render(<NotificationPreferencesUnavailable />);
    expect(
      screen.getByText("Notification preferences are unavailable"),
    ).toBeVisible();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByRole("main")).toHaveTextContent(
      "every alert this account would receive is still being sent",
    );
  });
});
