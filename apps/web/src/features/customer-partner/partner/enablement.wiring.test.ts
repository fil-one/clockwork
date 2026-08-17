import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("partner enablement route wiring", () => {
  it("mounts the dedicated view behind the shared partner membership check", () => {
    const root = path.resolve(process.cwd());
    const route = path.join(
      root,
      "app/(experience)/(partner)/partner/enablement/page.tsx",
    );
    expect(existsSync(route)).toBe(true);
    const source = readFileSync(route, "utf8");
    expect(source).toContain("partnerRouteMembership(session)");
    expect(source).toContain("<NoPartnerMembership />");
    expect(source).toContain("<PartnerEnablement");
    expect(source).not.toContain("PartnerCollectionRoute");
    expect(source).not.toContain("PartnerSurfaceKey");
  });
});
