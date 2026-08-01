import { describe, expect, it } from "vitest";

import { getCommandItems } from "./command-items";
import { isNavigationItemActive, navigation } from "./navigation";

describe("audience-aware shell commands", () => {
  const audienceRoles = {
    customer: ["owner"],
    partner: ["partner_admin"],
    internal: [
      "internal_operator",
      "finance_approver",
      "legal_approver",
      "destructive_action_approver",
    ],
  } as const;

  it.each(["customer", "partner", "internal"] as const)(
    "provides every result group for the %s portal",
    (audience) => {
      const items = getCommandItems(audience, audienceRoles[audience]);

      expect(new Set(items.map((item) => item.category))).toEqual(
        new Set(["navigation", "actions", "records"]),
      );
      expect(items.every((item) => item.audiences?.includes(audience))).toBe(
        true,
      );
    },
  );

  it("does not leak routes from another audience", () => {
    const customerHrefs = getCommandItems("customer", ["owner"]).flatMap(
      (item) => (item.href ? [item.href] : []),
    );
    const partnerHrefs = getCommandItems("partner", ["partner_admin"]).flatMap(
      (item) => (item.href ? [item.href] : []),
    );

    expect(customerHrefs.some((href) => href.startsWith("/partner"))).toBe(
      false,
    );
    expect(partnerHrefs.every((href) => href.startsWith("/partner"))).toBe(
      true,
    );
  });

  it("includes representative commercial records", () => {
    const customerItems = getCommandItems("customer", ["owner"]);

    expect(
      customerItems.some((item) => item.label.includes("INV-2026-0781")),
    ).toBe(true);
    expect(
      customerItems.some((item) => item.label.includes("Q-2026-0184-v3")),
    ).toBe(true);
  });

  it("hides customer write actions and agreement navigation from billing users", () => {
    const hrefs = getCommandItems("customer", ["billing"]).flatMap((item) =>
      item.href ? [item.href] : [],
    );

    expect(hrefs).not.toContain("/quotes/new");
    expect(hrefs).not.toContain("/account/users");
    expect(hrefs).not.toContain("/agreements");
    expect(hrefs).toContain("/billing");
  });

  it("hides partner administration destinations from sellers", () => {
    const hrefs = getCommandItems("partner", ["partner_seller"]).flatMap(
      (item) => (item.href ? [item.href] : []),
    );

    expect(hrefs).not.toContain("/partner/billing");
    expect(hrefs).not.toContain("/partner/commissions");
    expect(hrefs).not.toContain("/partner/renewals");
    expect(hrefs).not.toContain("/partner/sandboxes");
    expect(hrefs).not.toContain("/partner/brand");
    expect(hrefs).toContain("/partner/quotes/new");
    expect(hrefs).toContain("/partner/support");
  });

  it("hides approval and finance destinations from internal operators", () => {
    const hrefs = getCommandItems("internal", ["internal_operator"]).flatMap(
      (item) => (item.href ? [item.href] : []),
    );

    expect(hrefs).not.toContain("/internal/approvals");
    expect(hrefs).not.toContain("/internal/collections");
    expect(hrefs).not.toContain("/internal/price-books");
    expect(hrefs).toContain("/internal/provisioning");
    expect(hrefs).toContain("/internal/gates");
    expect(hrefs).toContain("/internal/reports");
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
