import { describe, expect, it } from "vitest";

import { permissionsForRoles, type Role } from "@clockwork/contracts";

import { translatorFor } from "@/src/i18n/catalogs";

import { getCommandItems } from "./command-items";
import {
  audienceCanAccess,
  canAccessNavigationItem,
  navigation,
  salesNavigation,
} from "./navigation";

const t = translatorFor("en");
const salesHrefs = salesNavigation.map(({ href }) => href as string);

const staff = (...roles: Role[]) =>
  permissionsForRoles(roles, { side: "fil_one" });

function visibleHrefs(granted: Role | readonly Role[]): string[] {
  const permissions = staff(
    ...(typeof granted === "string" ? [granted] : granted),
  );
  return navigation.internal
    .filter((item) => canAccessNavigationItem(item, permissions))
    .map(({ href }) => href);
}

describe("staff navigation by role", () => {
  it("shows a seller the sales workspace and nothing else", () => {
    expect(visibleHrefs("revenue")).toEqual([
      "/internal",
      "/internal/mndas",
      "/internal/contracts",
      "/internal/partners",
      "/internal/sales-library",
      "/internal/pricing",
    ]);
  });

  it("keeps billing, provisioning and platform tools out of a seller's rail", () => {
    const hrefs = visibleHrefs("revenue");
    for (const forbidden of [
      "/internal/operations",
      "/internal/search",
      "/internal/queues",
      "/internal/provisioning",
      "/internal/collections",
      "/internal/billing-reconciliation",
      "/internal/webhook-replay",
      "/internal/unhandled-errors",
      "/internal/migrations",
      "/internal/gates",
      "/internal/assisted",
      "/internal/approvals",
      "/internal/providers",
      "/internal/reports",
      "/internal/price-books",
      "/internal/team",
    ])
      expect(hrefs).not.toContain(forbidden);
  });

  it("shows a commerce administrator the sales workspace first, then every operations destination", () => {
    const hrefs = visibleHrefs("commerce_admin");
    expect(hrefs.slice(0, salesHrefs.length)).toEqual(salesHrefs);
    const operations = navigation.internal
      .filter((item) => item.workspace === "operations")
      .map(({ href }) => href as string);
    expect(hrefs.slice(salesHrefs.length)).toEqual(operations);
  });

  it("reserves the team page and the owner console for the commerce administrator", () => {
    const admin = visibleHrefs("commerce_admin");
    expect(admin).toContain("/internal/team");
    // Daily work leads the sales group; team and the owner console close it.
    expect(admin.slice(0, salesHrefs.length)).toEqual([
      "/internal",
      "/internal/mndas",
      "/internal/contracts",
      "/internal/partners",
      "/internal/sales-library",
      "/internal/pricing",
      "/internal/team",
      "/internal/owner",
    ]);
    for (const role of [
      "internal_operator",
      "finance_approver",
      "legal_approver",
      "destructive_action_approver",
      "revenue",
    ] as const) {
      expect(visibleHrefs(role)).not.toContain("/internal/team");
      expect(visibleHrefs(role)).not.toContain("/internal/owner");
    }
    // A seller who was also given administration sees both.
    expect(visibleHrefs(["revenue", "commerce_admin"])).toContain(
      "/internal/owner",
    );
  });

  it("gives an operations-only role no sales group", () => {
    const hrefs = visibleHrefs("destructive_action_approver");
    expect(hrefs.some((href) => salesHrefs.includes(href))).toBe(false);
    expect(hrefs).toContain("/internal/operations");
  });

  it("admits both new roles to the staff portal and no tenant role", () => {
    expect(audienceCanAccess("internal", staff("revenue"))).toBe(true);
    expect(audienceCanAccess("internal", staff("commerce_admin"))).toBe(true);
    expect(audienceCanAccess("internal", permissionsForRoles(["owner"]))).toBe(
      false,
    );
    expect(audienceCanAccess("customer", staff("revenue"))).toBe(false);
  });

  it.each([
    [
      "internal_operator",
      [
        "/internal/provisioning",
        "/internal/recovery",
        "/internal/webhook-replay",
        "/internal/migrations",
        "/internal/gates",
        "/internal/assisted",
        "/internal/providers",
        "/internal/catalog",
        "/internal/capabilities",
      ],
      [
        "/internal/approvals",
        "/internal/agreements",
        "/internal/payg-requests",
        "/internal/payg-offers",
        "/internal/channel-policy",
        "/internal/price-books",
      ],
    ],
    [
      "finance_approver",
      [
        "/internal/approvals",
        "/internal/payg-requests",
        "/internal/payg-offers",
        "/internal/channel-policy",
        "/internal/providers",
        "/internal/catalog",
        "/internal/capabilities",
      ],
      [
        "/internal/provisioning",
        "/internal/gates",
        "/internal/assisted",
        "/internal/migrations",
        "/internal/agreements",
      ],
    ],
    [
      "legal_approver",
      ["/internal/agreements", "/internal/approvals", "/internal/capabilities"],
      ["/internal/providers", "/internal/catalog", "/internal/payg-offers"],
    ],
    [
      "destructive_action_approver",
      ["/internal/approvals", "/internal/capabilities"],
      ["/internal/agreements", "/internal/providers", "/internal/gates"],
    ],
  ] as const)(
    "keeps each %s destination exactly where the role reached it",
    (role, shown, hidden) => {
      const hrefs = visibleHrefs(role);
      for (const href of shown) expect(hrefs).toContain(href);
      for (const href of hidden) expect(hrefs).not.toContain(href);
    },
  );

  it("shows a seller who also approves legal work both workspaces' destinations", () => {
    const hrefs = visibleHrefs(["revenue", "legal_approver"]);
    expect(hrefs.slice(0, 2)).toEqual(["/internal", "/internal/mndas"]);
    expect(hrefs).toContain("/internal/agreements");
    expect(hrefs).toContain("/internal/approvals");
    expect(hrefs).not.toContain("/internal/provisioning");
    expect(hrefs).not.toContain("/internal/team");
  });
});

describe("staff command palette", () => {
  const search = (granted: Role, term: string) =>
    getCommandItems(
      "internal",
      staff(granted),
      {
        providerBacked: true,
      },
      t,
    )
      .filter((item) =>
        [item.label, item.description ?? "", ...(item.keywords ?? [])]
          .join(" ")
          .toLowerCase()
          .includes(term),
      )
      .map((item) => item.href);

  it.each(["nda", "mnda", "contract"])(
    "finds the MNDA register for %s",
    (term) => {
      expect(search("revenue", term)).toContain("/internal/mndas");
    },
  );

  it("finds pricing", () => {
    expect(search("revenue", "pricing")).toContain("/internal/pricing");
    expect(search("revenue", "quote")).toContain("/internal/pricing");
  });

  it("offers a seller no operations command", () => {
    const hrefs = getCommandItems(
      "internal",
      staff("revenue"),
      { providerBacked: true },
      t,
    ).map((item) => item.href);
    // A create action opens inside its sales page, such as a new MNDA.
    const inSales = (href: string) => {
      const path = href.split("?")[0] ?? "";
      return salesHrefs.some((sales) =>
        sales === "/internal"
          ? path === sales
          : path === sales || path.startsWith(`${sales}/`),
      );
    };
    expect(hrefs.every((href) => href && inSales(href))).toBe(true);
  });
});
