import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { navigation } from "@/src/features/shell/navigation";

import {
  clientSafeEnablementItems,
  enablementItems,
  internalEnablementItems,
} from "./enablement-data";

describe("partner enablement destinations", () => {
  it("partitions every item into exactly one audience", () => {
    const clientSafe = clientSafeEnablementItems();
    const internal = enablementItems.filter(
      (item) => item.audience === "partner_internal",
    );
    expect(clientSafe).toHaveLength(3);
    expect(clientSafe.length + internal.length).toBe(enablementItems.length);
    expect(new Set(enablementItems.map((item) => item.id)).size).toBe(
      enablementItems.length,
    );
  });

  it("keeps every client-safe destination outside the partner account", () => {
    expect(clientSafeEnablementItems().map((item) => item.href)).toEqual([
      "/trust",
      "/developers",
      "/demo",
    ]);
    expect(
      clientSafeEnablementItems().every(
        (item) => !item.href.startsWith("/partner"),
      ),
    ).toBe(true);
  });

  it("filters administrative money and account work from sellers", () => {
    const seller = internalEnablementItems(["partner_seller"]);
    const admin = internalEnablementItems(["partner_admin"]);
    expect(seller.map((item) => item.href)).toContain("/partner/registrations");
    expect(seller.map((item) => item.href)).not.toContain(
      "/partner/commissions",
    );
    expect(admin.map((item) => item.href)).toContain("/partner/commissions");
    expect(admin.length).toBeGreaterThan(seller.length);
    expect(internalEnablementItems(["owner"])).toEqual([]);
  });

  it("keeps internal audience roles aligned with partner navigation", () => {
    const partnerNavigation = new Map(
      navigation.partner.map((item) => [item.href, item]),
    );
    for (const item of enablementItems.filter(
      (entry) =>
        entry.audience === "partner_internal" &&
        entry.href !== "/partner/quotes/new",
    )) {
      const navItem = partnerNavigation.get(item.href);
      expect(navItem, item.href).toBeDefined();
      expect(new Set(item.allowedRoles)).toEqual(
        new Set(navItem?.allowedRoles ?? ["partner_admin", "partner_seller"]),
      );
    }
  });

  it("names only routes present in the application tree", () => {
    const root = path.resolve(process.cwd());
    for (const item of enablementItems) {
      const relative = item.href.startsWith("/partner/")
        ? `app/(experience)/(partner)${item.href}/page.tsx`
        : `app${item.href}/page.tsx`;
      expect(existsSync(path.join(root, relative)), item.href).toBe(true);
    }
  });
});
