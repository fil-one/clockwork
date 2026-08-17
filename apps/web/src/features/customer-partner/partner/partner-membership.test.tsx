import { describe, expect, it } from "vitest";

import type { RouteSession } from "@/src/features/shell/route-session";

import { partnerRouteMembership } from "./partner-membership";

describe("partner route membership", () => {
  it("resolves only the effective account membership", () => {
    const memberships = [
      { accountId: "customer", accountName: "Customer" },
      { accountId: "partner", accountName: "Partner" },
    ] as unknown as RouteSession["memberships"];
    expect(
      partnerRouteMembership({ memberships, effectiveAccountId: "partner" })
        ?.accountName,
    ).toBe("Partner");
    expect(
      partnerRouteMembership({ memberships, effectiveAccountId: "missing" }),
    ).toBeUndefined();
  });
});
