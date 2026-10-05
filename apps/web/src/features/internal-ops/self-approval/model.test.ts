import { describe, expect, it } from "vitest";

import { permissionsForRoles } from "@clockwork/contracts";

import { mayApproveOwnRequests, selfApprovalErrorMessage } from "./model";

const admin = {
  roles: ["commerce_admin"],
  permissions: permissionsForRoles(["commerce_admin"], { side: "fil_one" }),
  mfaVerified: true,
};

describe("who is offered Approve my own request", () => {
  it("offers it to a commerce administrator in their own verified session", () => {
    expect(mayApproveOwnRequests(admin)).toBe(true);
  });
  it("withholds it without a verified second factor, including when unknown", () => {
    expect(mayApproveOwnRequests({ ...admin, mfaVerified: false })).toBe(false);
    const { mfaVerified: _unknown, ...unverified } = admin;
    expect(_unknown).toBe(true);
    expect(mayApproveOwnRequests(unverified)).toBe(false);
  });
  it("withholds it in an assisted session and from other roles", () => {
    expect(
      mayApproveOwnRequests({ ...admin, assistedSession: { id: "a" } }),
    ).toBe(false);
    expect(
      mayApproveOwnRequests({
        roles: ["finance_approver"],
        permissions: permissionsForRoles(["finance_approver"]),
        mfaVerified: true,
      }),
    ).toBe(false);
  });
});

it("words a refusal from whatever code the server sent", () => {
  expect(
    selfApprovalErrorMessage({ problemCode: "SELF_APPROVAL_NOT_PERMITTED" }),
  ).toBe("common.selfApproval.error.notPermitted");
  expect(
    selfApprovalErrorMessage(
      new Error("SELF_APPROVAL_REASON_REQUIRED: a reason is needed"),
    ),
  ).toBe("common.selfApproval.error.reason");
  expect(selfApprovalErrorMessage(new Error("boom"))).toBe(
    "common.selfApproval.error.generic",
  );
});
