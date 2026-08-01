import { describe, expect, it } from "vitest";

import {
  canRunProjectionAction,
  requireProjectionActionAuthority,
} from "./projection-authorization";

describe("projection action authority", () => {
  it("allows record-bound actions only to the corresponding authority", () => {
    expect(
      canRunProjectionAction(["owner"], "customer", "quotes", "accept"),
    ).toBe(true);
    expect(
      canRunProjectionAction(["billing"], "customer", "quotes", "accept"),
    ).toBe(false);
    expect(
      canRunProjectionAction(
        ["partner_seller"],
        "partner",
        "quotes",
        "issue_quote",
      ),
    ).toBe(true);
    expect(
      canRunProjectionAction(
        ["internal_operator"],
        "internal",
        "approvals",
        "approve_exception",
      ),
    ).toBe(false);
    expect(
      canRunProjectionAction(
        ["finance_approver"],
        "internal",
        "approvals",
        "approve_exception",
      ),
    ).toBe(true);
  });

  it("fails closed for forged or insufficient roles", () => {
    expect(() =>
      requireProjectionActionAuthority(
        ["forged-owner"],
        "customer",
        "orders",
        "accept",
      ),
    ).toThrow("cannot run this projection action");
  });
});
