import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("self-serve Buy route wiring", () => {
  it("mounts the authoritative component behind quote-write permission", () => {
    const route = path.join(
      process.cwd(),
      "app/(experience)/(customer)/buy/page.tsx",
    );
    expect(existsSync(route)).toBe(true);
    const source = readFileSync(route, "utf8");
    expect(source).toContain('requiredPermission="quote:write"');
    expect(source).toContain("explicitDemoIdentityEnabled()");
    expect(source).toContain("lookupPreparedQuoteArtifact");
    expect(source).toContain("lookupBuyQuoteProjection");
    expect(source).toContain("<SelfServeBuy");
  });
});
