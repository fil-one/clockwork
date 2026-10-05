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
  changeRole: vi.fn(),
  deactivate: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./actions", () => ({
  inviteStaffMember: mocks.invite,
  changeStaffRole: mocks.changeRole,
  deactivateStaffMember: mocks.deactivate,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import { demoTeamMembers, type TeamView } from "./model";
import { TeamWorkspace } from "./team-workspace";

const [admin, seller] = demoTeamMembers;
if (!admin || !seller) throw new Error("The demo team fixture is incomplete");
const live: TeamView = {
  mode: "live",
  members: demoTeamMembers,
  actorUserId: admin.userId,
  emailDomains: ["fil.one", "fil.org"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invite.mockResolvedValue({ ok: true });
  mocks.changeRole.mockResolvedValue({ ok: true });
  mocks.deactivate.mockResolvedValue({ ok: true });
});

function row(name: string) {
  return screen.getByRole("listitem", { name });
}

it("lists staff with role, authenticator status and date, and marks the reader", () => {
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
    within(own).queryByRole("button", { name: "Remove access" }),
  ).not.toBeInTheDocument();
  expect(
    within(row("Priya Raman")).getByText("Not confirmed yet"),
  ).toBeInTheDocument();
  expect(within(row(seller.name)).getByText(/^Checked /)).toBeInTheDocument();
});

it("adds a seller by default and explains that no email is sent", async () => {
  render(<TeamWorkspace view={live} />);
  expect(screen.getByText(/No email is sent/)).toBeInTheDocument();
  expect(
    screen.getByText("Use an address on fil.one or fil.org."),
  ).toBeInTheDocument();
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

it("changes a role with the version the reader saw", async () => {
  render(<TeamWorkspace view={live} />);
  const target = row(seller.name);
  const save = within(target).getByRole("button", { name: "Save role" });
  expect(save).toBeDisabled();
  fireEvent.change(within(target).getByLabelText(`Role for ${seller.name}`), {
    target: { value: "commerce_admin" },
  });
  fireEvent.click(save);
  await waitFor(() =>
    expect(mocks.changeRole).toHaveBeenCalledExactlyOnceWith({
      userId: seller.userId,
      role: "commerce_admin",
      expectedRowVersion: seller.rowVersion,
    }),
  );
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

it("words each refusal specifically and offers the sign-in check when it is stale", async () => {
  mocks.changeRole.mockResolvedValueOnce({
    ok: false,
    code: "RECENT_SIGN_IN_REQUIRED",
  });
  render(<TeamWorkspace view={live} />);
  const target = row(seller.name);
  fireEvent.change(within(target).getByLabelText(`Role for ${seller.name}`), {
    target: { value: "commerce_admin" },
  });
  fireEvent.click(within(target).getByRole("button", { name: "Save role" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(/team changes need a recent sign-in check/);
  expect(
    within(alert).getByRole("link", { name: "Verify sign-in" }),
  ).toHaveAttribute("href", "/access/mfa");
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
    screen.queryByRole("button", { name: "Remove access" }),
  ).not.toBeInTheDocument();
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

it("keeps approver roles out of reach on this page", () => {
  render(
    <TeamWorkspace
      view={{
        ...live,
        members: [
          admin,
          { ...seller, role: "finance_approver", name: "Elena Torres" },
        ],
      }}
    />,
  );
  const target = row("Elena Torres");
  expect(
    within(target).getByText("Managed by deployment provisioning"),
  ).toBeInTheDocument();
  expect(within(target).queryByRole("button")).not.toBeInTheDocument();
});
