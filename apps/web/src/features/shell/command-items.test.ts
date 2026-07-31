import { describe, expect, it } from "vitest";

import { getCommandItems } from "./command-items";
import { isNavigationItemActive, navigation } from "./navigation";

describe("audience-aware shell commands", () => {
  it.each(["customer", "partner", "internal"] as const)(
    "provides every result group for the %s portal",
    (audience) => {
      const items = getCommandItems(audience);

      expect(new Set(items.map((item) => item.category))).toEqual(
        new Set(["navigation", "actions", "records"]),
      );
      expect(items.every((item) => item.audiences?.includes(audience))).toBe(
        true,
      );
    },
  );

  it("does not leak routes from another audience", () => {
    const customerHrefs = getCommandItems("customer").flatMap((item) =>
      item.href ? [item.href] : [],
    );
    const partnerHrefs = getCommandItems("partner").flatMap((item) =>
      item.href ? [item.href] : [],
    );

    expect(customerHrefs.some((href) => href.startsWith("/partner"))).toBe(
      false,
    );
    expect(partnerHrefs.every((href) => href.startsWith("/partner"))).toBe(
      true,
    );
  });

  it("includes representative commercial records", () => {
    const customerItems = getCommandItems("customer");

    expect(
      customerItems.some((item) => item.label.includes("INV-2026-0781")),
    ).toBe(true);
    expect(
      customerItems.some((item) => item.label.includes("Q-2026-0184-v3")),
    ).toBe(true);
  });

  it("marks section roots only on their exact page", () => {
    const partnerHome = navigation.partner.find(
      (item) => item.href === "/partner",
    );
    const partnerPortfolio = navigation.partner.find(
      (item) => item.href === "/partner/portfolio",
    );
    if (!partnerHome || !partnerPortfolio) {
      throw new Error("Expected partner navigation fixtures");
    }

    expect(isNavigationItemActive(partnerHome, "/partner")).toBe(true);
    expect(isNavigationItemActive(partnerHome, "/partner/portfolio")).toBe(
      false,
    );
    expect(
      isNavigationItemActive(partnerPortfolio, "/partner/portfolio/EC-0038"),
    ).toBe(true);
  });
});
