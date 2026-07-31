import { describe, expect, it } from "vitest";

import { gates } from "./demo-data";

describe("external gate admin projection", () => {
  it("shows every permitted activation gate exactly once", () => {
    const expected = [
      "EXT-ACC-01",
      "EXT-APPROVERS-01",
      "EXT-BRAND-01",
      "EXT-COMMERCIAL-01",
      "EXT-DOMAIN-01",
      "EXT-LEGAL-01",
      "EXT-MARKETPLACE-01",
      "EXT-MIGRATION-01",
      "EXT-PROVIDER-01",
      "EXT-PROVISION-01",
      "EXT-TAX-01",
      "EXT-TEARDOWN-01",
    ];

    expect(gates.map(({ id }) => id).sort()).toEqual(expected);
    expect(new Set(gates.map(({ id }) => id))).toHaveProperty(
      "size",
      gates.length,
    );
    expect(
      gates.every(({ status }) =>
        ["status.blocked", "status.pending", "status.review"].includes(status),
      ),
    ).toBe(true);
  });
});
