import { describe, expect, it } from "vitest";

import { permissionsForRoles } from "@clockwork/contracts";

import { translatorFor } from "@/src/i18n/catalogs";

import { getCommandItems } from "./command-items";
import { isNavigationItemActive, navigation } from "./navigation";

describe("audience-aware shell commands", () => {
  const t = translatorFor("en");
  const providerContext = { providerBacked: true } as const;
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
    "provides account-safe navigation and actions for the %s portal",
    (audience) => {
      const items = getCommandItems(
        audience,
        permissionsForRoles(audienceRoles[audience]),
        providerContext,
        t,
      );

      expect(new Set(items.map((item) => item.category))).toEqual(
        new Set(["navigation", "actions"]),
      );
      expect(items.every((item) => item.audiences?.includes(audience))).toBe(
        true,
      );
    },
  );

  it("does not leak routes from another audience", () => {
    const customerHrefs = getCommandItems(
      "customer",
      permissionsForRoles(["owner"]),
      providerContext,
      t,
    ).flatMap((item) => (item.href ? [item.href] : []));
    const partnerHrefs = getCommandItems(
      "partner",
      permissionsForRoles(["partner_admin"]),
      providerContext,
      t,
    ).flatMap((item) => (item.href ? [item.href] : []));

    expect(customerHrefs.some((href) => href.startsWith("/partner"))).toBe(
      false,
    );
    expect(partnerHrefs.every((href) => href.startsWith("/partner"))).toBe(
      true,
    );
  });

  it("does not expose fixture records in a provider-backed shell", () => {
    const items = getCommandItems(
      "customer",
      permissionsForRoles(["owner"]),
      providerContext,
      t,
    );

    expect(items.some((item) => item.category === "records")).toBe(false);
    expect(items.map((item) => item.label).join(" ")).not.toMatch(
      /Northstar|Meridian|INV-2026|Q-2026|ORD-2026/,
    );
  });

  it("hides customer write actions and agreement navigation from billing users", () => {
    const hrefs = getCommandItems(
      "customer",
      permissionsForRoles(["billing"]),
      providerContext,
      t,
    ).flatMap((item) => (item.href ? [item.href] : []));

    expect(hrefs).not.toContain("/quotes/new");
    expect(hrefs).not.toContain("/account/users");
    expect(hrefs).not.toContain("/agreements");
    expect(hrefs).toContain("/billing");
  });

  it("hides partner administration destinations from sellers", () => {
    const hrefs = getCommandItems(
      "partner",
      permissionsForRoles(["partner_seller"]),
      providerContext,
      t,
    ).flatMap((item) => (item.href ? [item.href] : []));

    expect(hrefs).not.toContain("/partner/billing");
    expect(hrefs).not.toContain("/partner/commissions");
    expect(hrefs).not.toContain("/partner/renewals");
    expect(hrefs).not.toContain("/partner/sandboxes");
    expect(hrefs).not.toContain("/partner/brand");
    expect(hrefs).toContain("/partner/enablement");
    expect(hrefs).toContain("/partner/quotes/new");
    expect(hrefs).toContain("/partner/support");
  });

  it("offers a referral partner deal registration but never the partner quote", () => {
    const hrefs = getCommandItems(
      "partner",
      permissionsForRoles(["partner_admin"], { side: "referral_partner" }),
      providerContext,
      t,
    ).flatMap((item) => (item.href ? [item.href] : []));

    expect(hrefs).toContain("/partner/registrations");
    expect(hrefs).toContain("/partner/billing");
    expect(hrefs).not.toContain("/partner/quotes/new");
  });

  it("offers sellers New MNDA and Record a contract, and says what each sales page holds", () => {
    const items = getCommandItems(
      "internal",
      permissionsForRoles(["revenue"], { side: "fil_one" }),
      providerContext,
      t,
    );
    const byId = (id: string) => items.find((item) => item.id === id);
    expect(byId("action-new-mnda")).toMatchObject({
      label: "New MNDA",
      href: "/internal/mndas?compose=1",
      category: "actions",
    });
    expect(byId("action-record-contract")).toMatchObject({
      label: "Record a contract",
      href: "/internal/contracts/new",
      category: "actions",
    });
    expect(byId("navigation-/internal/contracts")?.description).toBe(
      "Every agreement, signed or in progress",
    );
    expect(byId("navigation-/internal/sales-library")?.description).toBe(
      "Decks, one-pagers and case studies to share",
    );
  });

  it("leaves New MNDA out of the demo, where the composer is turned off", () => {
    const permissions = permissionsForRoles(["revenue"], { side: "fil_one" });
    const ids = (demoIdentity: boolean) =>
      getCommandItems(
        "internal",
        permissions,
        { providerBacked: false, demoIdentity },
        t,
      ).map((item) => item.id);
    expect(ids(true)).not.toContain("action-new-mnda");
    expect(ids(true)).toContain("action-record-contract");
    expect(ids(false)).toContain("action-new-mnda");
  });

  it("keeps the staff create actions from staff without the permission", () => {
    const ids = getCommandItems(
      "internal",
      permissionsForRoles(["destructive_action_approver"], {
        side: "fil_one",
      }),
      providerContext,
      t,
    ).map((item) => item.id);
    expect(ids).not.toContain("action-new-mnda");
    expect(ids).not.toContain("action-record-contract");
  });

  it("hides approval and finance destinations from internal operators", () => {
    const hrefs = getCommandItems(
      "internal",
      permissionsForRoles(["internal_operator"]),
      providerContext,
      t,
    ).flatMap((item) => (item.href ? [item.href] : []));

    expect(hrefs).not.toContain("/internal/approvals");
    expect(hrefs).not.toContain("/internal/collections");
    expect(hrefs).not.toContain("/internal/price-books");
    expect(hrefs).toContain("/internal/provisioning");
    expect(hrefs).toContain("/internal/gates");
    expect(hrefs).toContain("/internal/reports");
    expect(hrefs).toContain("/internal/revenue");
    expect(hrefs).toContain("/internal/billing-reconciliation");
    expect(hrefs).toContain("/internal/status");
    expect(hrefs).toContain("/internal/unhandled-errors");
  });

  it("keeps finance navigation behind report read and recovery behind system operate", () => {
    const financeHrefs = getCommandItems(
      "internal",
      permissionsForRoles(["finance_approver"]),
      providerContext,
      t,
    ).flatMap((item) => (item.href ? [item.href] : []));
    expect(financeHrefs).toContain("/internal/billing-reconciliation");
    expect(financeHrefs).toContain("/internal/revenue");
    expect(financeHrefs).not.toContain("/internal/unhandled-errors");
    expect(financeHrefs).not.toContain("/internal/status");
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
  it("marks only the selected customer purchase destination active", () => {
    const buy = navigation.customer.find((item) => item.href === "/buy");
    const payg = navigation.customer.find((item) => item.href === "/buy/payg");
    if (!buy || !payg)
      throw new Error("Customer purchase navigation is missing");
    expect(isNavigationItemActive(buy, "/buy")).toBe(true);
    expect(isNavigationItemActive(buy, "/buy/payg")).toBe(false);
    expect(isNavigationItemActive(payg, "/buy/payg")).toBe(true);
  });
});
