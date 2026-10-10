import { describe, expect, it } from "vitest";

import { coreCommandCapabilities } from "./capability-requirements";

describe("core command capability requirements", () => {
  it("runs dunning evaluation as billing recovery, other invoice work as new billing", () => {
    expect(
      coreCommandCapabilities({
        resource: "invoices",
        action: "evaluate_dunning",
      }),
    ).toEqual({ capabilities: ["billing"], recovery: true });
    expect(
      coreCommandCapabilities({ resource: "invoices", action: "create" }),
    ).toEqual({ capabilities: ["billing"], recovery: false });
  });

  it("needs new business, legal and billing for order work, plus the route's channel", () => {
    expect(
      coreCommandCapabilities({
        resource: "orders",
        action: "prepare_artifact",
      }).capabilities,
    ).toEqual(["new_business", "legal", "billing"]);
    expect(
      coreCommandCapabilities({
        resource: "orders",
        action: "create",
        route: "resale",
      }).capabilities,
    ).toEqual(["new_business", "legal", "billing", "partner"]);
  });

  it("needs new business and legal for quote and account work", () => {
    for (const resource of ["quotes", "accounts"])
      expect(coreCommandCapabilities({ resource, action: "issue" })).toEqual({
        capabilities: ["new_business", "legal"],
        recovery: false,
      });
  });

  it("needs no switch for price-book administration", () => {
    for (const action of [
      "create",
      "clone",
      "import",
      "add_rate",
      "update_rate",
      "remove_rate",
      "update_discount_matrix",
      "reject_activation",
      "schedule_activation",
      "cancel_schedule",
      "request_activation",
      "activate",
      "retire",
    ])
      expect(
        coreCommandCapabilities({ resource: "price_books", action }),
      ).toEqual({ capabilities: [], recovery: false });
  });

  it("needs nothing for a resource outside the core command set", () => {
    expect(
      coreCommandCapabilities({ resource: "exceptions", action: "review" }),
    ).toEqual({ capabilities: [], recovery: false });
  });
});
