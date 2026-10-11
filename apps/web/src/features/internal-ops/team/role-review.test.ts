import { expect, it } from "vitest";
import { demoTeamMembers, staffPermissions, type TeamView } from "./model";
import {
  buildStaffRoleReviewUrl,
  parseStaffRoleReviewQuery,
  resolveStaffRoleReview,
  type StaffRoleReviewRequest,
} from "./role-review";

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
const query = Object.fromEntries(
  new URL(buildStaffRoleReviewUrl(request), "https://clockwork.test")
    .searchParams,
);

it("round trips the full bound proposal and ignores unrelated page filters", () => {
  expect(parseStaffRoleReviewQuery({ ...query, tab: "team" })).toEqual(request);
  expect(parseStaffRoleReviewQuery({})).toBeNull();
});

it.each([
  { reviewActorId: undefined },
  { reviewUserId: "somebody" },
  { reviewAction: "delete" },
  { reviewRole: "owner" },
  { reviewVersion: "0" },
  { reviewVersion: "1.5" },
  { reviewVersion: "1e3" },
  { reviewVersion: "9007199254740992" },
  { reviewUserId: [target.userId, target.userId] },
  { reviewActorId: [actor.userId] },
])("refuses malformed or duplicated review query %#", (patch) => {
  expect(parseStaffRoleReviewQuery({ ...query, ...patch })).toBe("invalid");
});

it("calculates the exact resulting permissions and preserves the primary role on grant", () => {
  const result = resolveStaffRoleReview(view, {
    ...request,
    role: "commerce_admin",
  });
  expect(result.state).toBe("ready");
  if (result.state !== "ready") throw new Error("Expected valid review");
  expect(result.member.email).toBe(target.email);
  expect(result.afterRoles).toEqual([
    "revenue",
    "commerce_admin",
    "legal_approver",
  ]);
  expect(result.beforePermissions).toEqual(staffPermissions(target.roles));
  expect(result.afterPermissions).toEqual(staffPermissions(result.afterRoles));
});

it("selects the remaining primary role when the old primary is removed", () => {
  const result = resolveStaffRoleReview(view, {
    ...request,
    action: "revoke",
    role: "revenue",
  });
  expect(result).toMatchObject({
    state: "ready",
    afterRoles: ["legal_approver"],
  });
});

it.each([
  [{ actorUserId: target.userId }, "REVIEW_ACTOR"],
  [{ userId: actor.userId }, "SELF_CHANGE"],
  [{ userId: "00000000-0000-4000-8000-000000000099" }, "MEMBER_NOT_FOUND"],
  [{ expectedRowVersion: 99 }, "STALE"],
  [{ role: "revenue" }, "ROLE_UNCHANGED"],
  [{ action: "revoke" }, "ROLE_NOT_HELD"],
] as const)("refuses unsafe or outdated proposal %#", (patch, code) => {
  expect(resolveStaffRoleReview(view, { ...request, ...patch })).toMatchObject({
    state: "error",
    code,
  });
});

it("refuses demo data, last-role removal and last-administrator removal", () => {
  expect(
    resolveStaffRoleReview({ ...view, mode: "demo" }, request),
  ).toMatchObject({ code: "NOT_CONFIGURED" });
  expect(
    resolveStaffRoleReview(
      { ...view, members: [{ ...target, roles: ["revenue"] }] },
      { ...request, action: "revoke", role: "revenue" },
    ),
  ).toMatchObject({ code: "LAST_ROLE" });
  expect(
    resolveStaffRoleReview(
      {
        ...view,
        members: [{ ...target, roles: ["commerce_admin", "revenue"] }],
      },
      { ...request, action: "revoke", role: "commerce_admin" },
    ),
  ).toMatchObject({ code: "LAST_ADMIN" });
});
