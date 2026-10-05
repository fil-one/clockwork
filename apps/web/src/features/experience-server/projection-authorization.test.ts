import { describe, expect, it } from "vitest";

import { permissionsForRoles } from "@clockwork/contracts";

import {
  canRunProjectionAction,
  requireProjectionActionAuthority,
} from "./projection-authorization";

describe("projection action authority", () => {
  it("allows record-bound actions only to the corresponding authority", () => {
    expect(
      canRunProjectionAction(
        permissionsForRoles(["owner"]),
        "customer",
        "quotes",
        "accept",
      ),
    ).toBe(true);
    expect(
      canRunProjectionAction(
        permissionsForRoles(["billing"]),
        "customer",
        "quotes",
        "accept",
      ),
    ).toBe(false);
    expect(
      canRunProjectionAction(
        permissionsForRoles(["partner_seller"]),
        "partner",
        "quotes",
        "issue_quote",
      ),
    ).toBe(true);
    expect(
      canRunProjectionAction(
        permissionsForRoles(["internal_operator"]),
        "internal",
        "approvals",
        "approve_exception",
      ),
    ).toBe(false);
    expect(
      canRunProjectionAction(
        permissionsForRoles(["finance_approver"]),
        "internal",
        "approvals",
        "approve_exception",
      ),
    ).toBe(true);
  });

  it("lets a referral partner act on its registrations but never price a quote", () => {
    const referral = permissionsForRoles(["partner_seller"], {
      side: "referral_partner",
    });
    expect(
      canRunProjectionAction(referral, "partner", "registrations", "withdraw"),
    ).toBe(true);
    expect(
      canRunProjectionAction(referral, "partner", "disputes", "raise_dispute"),
    ).toBe(true);
    expect(
      canRunProjectionAction(referral, "partner", "quotes", "issue_quote"),
    ).toBe(false);
    expect(
      canRunProjectionAction(
        referral,
        "partner",
        "portfolio",
        "create_resale_quote",
      ),
    ).toBe(false);
    expect(
      canRunProjectionAction(
        permissionsForRoles(["partner_seller"], { side: "channel_partner" }),
        "partner",
        "portfolio",
        "create_resale_quote",
      ),
    ).toBe(true);
  });

  it("withholds approval actions inside an assisted session", () => {
    expect(
      canRunProjectionAction(
        permissionsForRoles(["commerce_admin"], { assisted: true }),
        "internal",
        "approvals",
        "approve_exception",
      ),
    ).toBe(false);
  });

  it("fails closed for a session without the permission", () => {
    expect(() =>
      requireProjectionActionAuthority([], "customer", "orders", "accept"),
    ).toThrow("cannot run this projection action");
  });
});
