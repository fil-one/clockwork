import { describe, expect, it } from "vitest";

import { coreSnapshotHash } from "@clockwork/db";

describe("core-finance persistence evidence", () => {
  it("hashes object keys canonically across insertion order", () => {
    const left = {
      currency: "USD",
      lines: [{ sku: "LOCKED-STORAGE-TB", quantity: "1.000000000000000000" }],
      totalMinor: "180000",
    };
    const right = {
      totalMinor: "180000",
      lines: [{ quantity: "1.000000000000000000", sku: "LOCKED-STORAGE-TB" }],
      currency: "USD",
    };

    expect(coreSnapshotHash(left)).toBe(coreSnapshotHash(right));
    expect(coreSnapshotHash(left)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps array order material to issued commercial evidence", () => {
    const first = { lines: [{ sku: "A" }, { sku: "B" }] };
    const reordered = { lines: [{ sku: "B" }, { sku: "A" }] };

    expect(coreSnapshotHash(first)).not.toBe(coreSnapshotHash(reordered));
  });
});
