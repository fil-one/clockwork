import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invite: vi.fn(),
  grant: vi.fn(),
  revoke: vi.fn(),
  deactivate: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./actions", () => ({
  inviteStaffMember: mocks.invite,
  grantStaffRole: mocks.grant,
  revokeStaffRole: mocks.revoke,
  deactivateStaffMember: mocks.deactivate,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import { demoTeamMembers, type TeamView } from "./model";
import { TeamWorkspace } from "./team-workspace";

const [admin, seller, newcomer] = demoTeamMembers;
if (!admin || !seller || !newcomer)
  throw new Error("The demo team fixture is incomplete");
const live: TeamView = {
  mode: "live",
  members: demoTeamMembers,
  actorUserId: admin.userId,
  emailDomains: ["fil.one", "fil.org"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invite.mockResolvedValue({ ok: true });
  mocks.grant.mockResolvedValue({ ok: true });
  mocks.revoke.mockResolvedValue({ ok: true });
  mocks.deactivate.mockResolvedValue({ ok: true });
});

function row(name: string) {
  return screen.getByRole("listitem", { name });
}

function openRoles(name: string) {
  fireEvent.click(
    within(row(name)).getByRole("button", { name: "Change roles" }),
  );
  return screen.getByRole("dialog", { name: `Roles for ${name}` });
}

function roleOption(dialog: HTMLElement, label: string) {
  const option = within(dialog).getByText(label).closest("li");
  if (!option) throw new Error(`No ${label} option`);
  return option;
}

it("lists staff with every role, authenticator status and date, and marks the reader", () => {
  render(<TeamWorkspace view={live} />);
  const own = row(admin.name);
  expect(within(own).getByText("You")).toBeInTheDocument();
  expect(within(own).getByText("Commerce administrator")).toBeInTheDocument();
  expect(
    within(own).getByText(
      "Another commerce administrator can change your access.",
    ),
  ).toBeInTheDocument();
  expect(
    within(own).queryByRole("button", { name: "Change roles" }),
  ).not.toBeInTheDocument();
  // Roles say what someone may do, not where anything stands: neutral tags.
  expect(within(own).getByText("Commerce administrator")).toHaveClass("cw-tag");
  const both = row(seller.name);
  expect(within(both).getByText("Revenue")).toBeInTheDocument();
  expect(within(both).getByText("Legal approver")).toBeInTheDocument();
  expect(
    within(row(newcomer.name)).getByText("Not confirmed yet"),
  ).toBeInTheDocument();
  expect(within(both).getByText(/^Checked /)).toBeInTheDocument();
});

it("describes every staff role and how roles combine", () => {
  render(<TeamWorkspace view={live} />);
  const roles = screen.getByRole("region", { name: "What each role can do" });
  expect(within(roles).getByText(/can hold several roles/)).toBeInTheDocument();
  for (const label of [
    "Commerce administrator",
    "Internal operator",
    "Revenue",
    "Finance approver",
    "Legal approver",
    "Destructive-action approver",
  ])
    expect(within(roles).getByText(label)).toBeInTheDocument();
  expect(
    within(roles).getByText(
      "Sales work: the home page, MNDAs, contracts, the sales library and pricing.",
    ),
  ).toBeInTheDocument();
});

it("adds a seller by default and explains that no email is sent", async () => {
  render(<TeamWorkspace view={live} />);
  expect(screen.getByText(/No email is sent/)).toBeInTheDocument();
  expect(
    screen.getByText("Use an address on fil.one or fil.org."),
  ).toBeInTheDocument();
  expect(
    within(screen.getByLabelText("Role")).getAllByRole("option"),
  ).toHaveLength(6);
  fireEvent.change(screen.getByLabelText("Full name"), {
    target: { value: "Sam Ortiz" },
  });
  fireEvent.change(screen.getByLabelText("Work email"), {
    target: { value: "sam@fil.one" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add to team" }));
  await waitFor(() =>
    expect(mocks.invite).toHaveBeenCalledExactlyOnceWith({
      name: "Sam Ortiz",
      email: "sam@fil.one",
      role: "revenue",
    }),
  );
  expect(
    await screen.findAllByText(/Sam Ortiz can now sign in with sam@fil.one/),
  ).not.toHaveLength(0);
  expect(mocks.refresh).toHaveBeenCalled();
});

it("adds a role with the version the reader saw and the note for the record", async () => {
  render(<TeamWorkspace view={live} />);
  const dialog = openRoles(newcomer.name);
  expect(
    within(roleOption(dialog, "Revenue")).getByText("Decides their home page"),
  ).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText(/Note for the record/), {
    target: { value: "Covers contract review in Q4" },
  });
  fireEvent.click(
    within(roleOption(dialog, "Legal approver")).getByRole("button", {
      name: "Add role",
    }),
  );
  await waitFor(() =>
    expect(mocks.grant).toHaveBeenCalledExactlyOnceWith({
      userId: newcomer.userId,
      role: "legal_approver",
      expectedRowVersion: newcomer.rowVersion,
      reason: "Covers contract review in Q4",
    }),
  );
  expect(
    await within(dialog).findAllByText(
      `${newcomer.name} now has the Legal approver role.`,
    ),
  ).not.toHaveLength(0);
  expect(mocks.refresh).toHaveBeenCalled();
});

it("removes one of several roles, and never someone's only role", async () => {
  render(<TeamWorkspace view={live} />);
  const dialog = openRoles(seller.name);
  fireEvent.click(
    within(roleOption(dialog, "Legal approver")).getByRole("button", {
      name: "Remove role",
    }),
  );
  await waitFor(() =>
    expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith({
      userId: seller.userId,
      role: "legal_approver",
      expectedRowVersion: seller.rowVersion,
    }),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

  const single = openRoles(newcomer.name);
  expect(
    within(roleOption(single, "Revenue")).getByRole("button", {
      name: "Remove role",
    }),
  ).toBeDisabled();
  expect(within(single).getByText(/This is their only role/)).toBeVisible();
});

it("words each refusal in the dialog and offers the sign-in check when it is stale", async () => {
  mocks.grant.mockResolvedValueOnce({
    ok: false,
    code: "RECENT_SIGN_IN_REQUIRED",
  });
  render(<TeamWorkspace view={live} />);
  const dialog = openRoles(newcomer.name);
  fireEvent.click(
    within(roleOption(dialog, "Finance approver")).getByRole("button", {
      name: "Add role",
    }),
  );
  const alert = await within(dialog).findByRole("alert");
  expect(alert).toHaveTextContent(/team changes need a recent sign-in check/);
  expect(
    within(alert).getByRole("link", { name: "Verify sign-in" }),
  ).toHaveAttribute("href", "/access/mfa");
});

it("offers a reload, not the sign-in check, when the session expired", async () => {
  mocks.grant.mockResolvedValueOnce({ ok: false, code: "SESSION_EXPIRED" });
  render(<TeamWorkspace view={live} />);
  const dialog = openRoles(newcomer.name);
  fireEvent.click(
    within(roleOption(dialog, "Finance approver")).getByRole("button", {
      name: "Add role",
    }),
  );
  const alert = await within(dialog).findByRole("alert");
  expect(alert).toHaveTextContent("Your session expired. Reload to continue.");
  expect(within(alert).queryByRole("link")).toBeNull();
  fireEvent.click(within(alert).getByRole("button", { name: "Reload" }));
  await waitFor(() => expect(within(dialog).queryByRole("alert")).toBeNull());
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it("explains why the last administrator keeps the role", async () => {
  mocks.revoke.mockResolvedValueOnce({ ok: false, code: "LAST_ADMIN" });
  render(<TeamWorkspace view={live} />);
  const dialog = openRoles(seller.name);
  fireEvent.click(
    within(roleOption(dialog, "Revenue")).getByRole("button", {
      name: "Remove role",
    }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    /at least one commerce administrator/,
  );
});

it("shows everything a person can do on demand", () => {
  render(<TeamWorkspace view={live} />);
  const target = row(newcomer.name);
  const toggle = within(target).getByRole("button", {
    name: "What they can do",
  });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(toggle).toHaveAccessibleDescription(newcomer.name);
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(within(target).getByText("Send MNDAs")).toBeInTheDocument();
  expect(
    within(target).queryByText(
      "Add staff, change their roles and remove their access",
    ),
  ).not.toBeInTheDocument();
  fireEvent.click(toggle);
  expect(within(target).queryByText("Send MNDAs")).not.toBeInTheDocument();
});

it("asks for confirmation before removing access, and can back out", async () => {
  render(<TeamWorkspace view={live} />);
  const target = row(seller.name);
  fireEvent.click(
    within(target).getByRole("button", { name: "Remove access" }),
  );
  expect(
    within(target).getByText(/They will no longer be able to sign in/),
  ).toBeInTheDocument();
  fireEvent.click(within(target).getByRole("button", { name: "Keep access" }));
  expect(mocks.deactivate).not.toHaveBeenCalled();
  fireEvent.click(
    within(target).getByRole("button", { name: "Remove access" }),
  );
  const confirm = within(target).getByRole("button", { name: "Remove access" });
  expect(confirm).toHaveFocus();
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(mocks.deactivate).toHaveBeenCalledExactlyOnceWith({
      userId: seller.userId,
      expectedRowVersion: seller.rowVersion,
    }),
  );
});

it("rereads the list when someone else changed it first", async () => {
  mocks.deactivate.mockResolvedValueOnce({ ok: false, code: "STALE" });
  render(<TeamWorkspace view={live} />);
  const target = row(seller.name);
  fireEvent.click(
    within(target).getByRole("button", { name: "Remove access" }),
  );
  fireEvent.click(
    within(target).getByRole("button", { name: "Remove access" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /changed this person's access a moment ago/,
  );
  expect(mocks.refresh).toHaveBeenCalled();
});

it("shows the demo list read-only", () => {
  render(<TeamWorkspace view={{ ...live, mode: "demo" }} />);
  expect(screen.getByText(/This demo shows sample people/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Add to team" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Change roles" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Remove access" }),
  ).not.toBeInTheDocument();
  expect(
    within(row(seller.name)).getByRole("button", { name: "What they can do" }),
  ).toBeInTheDocument();
});

it("explains a list that could not be read instead of claiming the team is empty", () => {
  render(
    <TeamWorkspace view={{ ...live, mode: "unavailable", members: [] }} />,
  );
  expect(
    screen.getByText(/The team list could not be loaded right now/),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("No one is on the team yet"),
  ).not.toBeInTheDocument();
});

it("leaves a role from outside the staff roles to deployment provisioning", () => {
  render(
    <TeamWorkspace
      view={{
        ...live,
        members: [
          admin,
          {
            ...seller,
            role: "owner",
            roles: ["owner"],
            name: "Elena Torres",
          },
        ],
      }}
    />,
  );
  const target = row("Elena Torres");
  expect(
    within(target).getByText("Managed by deployment provisioning"),
  ).toBeInTheDocument();
  expect(
    within(target).queryByRole("button", { name: "Change roles" }),
  ).not.toBeInTheDocument();
});
