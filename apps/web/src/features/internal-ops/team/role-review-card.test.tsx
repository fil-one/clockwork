import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  grant: vi.fn(),
  revoke: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./actions", () => ({
  grantStaffRole: mocks.grant,
  revokeStaffRole: mocks.revoke,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import { demoTeamMembers, type TeamView } from "./model";
import {
  resolveStaffRoleReview,
  type StaffRoleReviewRequest,
} from "./role-review";
import { StaffRoleReviewCard } from "./role-review-card";

const actor = demoTeamMembers[0];
const target = demoTeamMembers[1];
if (!actor || !target) throw new Error("Missing team fixture");
const view: TeamView = {
  mode: "live",
  members: demoTeamMembers,
  actorUserId: actor.userId,
  emailDomains: ["fil.one"],
};
const request: StaffRoleReviewRequest = {
  userId: target.userId,
  actorUserId: actor.userId,
  action: "grant",
  role: "finance_approver",
  expectedRowVersion: target.rowVersion,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.grant.mockResolvedValue({ ok: true });
  mocks.revoke.mockResolvedValue({ ok: true });
});

it("shows exact identity and before/after permissions without calling an action on load", () => {
  render(
    <StaffRoleReviewCard review={resolveStaffRoleReview(view, request)} />,
  );
  expect(screen.getByText(target.email)).toBeInTheDocument();
  expect(screen.getByText(target.name)).toBeInTheDocument();
  expect(
    within(
      screen.getByRole("region", { name: "Permissions before" }),
    ).getAllByRole("listitem").length,
  ).toBeGreaterThan(0);
  expect(
    within(
      screen.getByRole("region", { name: "Permissions after" }),
    ).getAllByRole("listitem").length,
  ).toBeGreaterThan(0);
  expect(mocks.grant).not.toHaveBeenCalled();
  expect(mocks.revoke).not.toHaveBeenCalled();
});

it.each(["grant", "revoke"] as const)(
  "requires explicit confirmation before %s with original actor and version",
  async (action) => {
    const proposal = {
      ...request,
      action,
      role:
        action === "grant"
          ? ("finance_approver" as const)
          : ("legal_approver" as const),
    };
    render(
      <StaffRoleReviewCard review={resolveStaffRoleReview(view, proposal)} />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm role change" }),
    );
    await waitFor(() =>
      expect(mocks[action]).toHaveBeenCalledExactlyOnceWith({
        userId: request.userId,
        role: proposal.role,
        expectedRowVersion: request.expectedRowVersion,
        expectedActorUserId: request.actorUserId,
      }),
    );
    expect(
      await screen.findByText("The role change was saved."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirm role change" }),
    ).not.toBeInTheDocument();
  },
);

it("preserves the exact review in the MFA link and does not retry automatically", async () => {
  mocks.grant.mockResolvedValue({ ok: false, code: "RECENT_SIGN_IN_REQUIRED" });
  const review = resolveStaffRoleReview(view, request);
  render(<StaffRoleReviewCard review={review} />);
  fireEvent.click(screen.getByRole("button", { name: "Confirm role change" }));
  const link = await screen.findByRole("link", { name: "Verify sign-in" });
  const href = new URL(
    link.getAttribute("href") ?? "",
    "https://clockwork.test",
  );
  expect(href.searchParams.get("returnTo")).toBe(review.reviewUrl);
  expect(mocks.grant).toHaveBeenCalledOnce();
});

it.each(["STALE", "ACTOR_CHANGED"] as const)(
  "blocks further confirmation when the server reports %s",
  async (code) => {
    mocks.grant.mockResolvedValue({ ok: false, code });
    render(
      <StaffRoleReviewCard review={resolveStaffRoleReview(view, request)} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm role change" }),
    );
    await screen.findByRole("alert");
    expect(
      await screen.findByRole("button", { name: "Confirm role change" }),
    ).toBeDisabled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  },
);

it("shows an invalid-link explanation with no confirmation control", () => {
  render(
    <StaffRoleReviewCard review={{ state: "error", code: "REVIEW_INVALID" }} />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("incomplete or invalid");
  expect(
    screen.queryByRole("button", { name: "Confirm role change" }),
  ).not.toBeInTheDocument();
});
