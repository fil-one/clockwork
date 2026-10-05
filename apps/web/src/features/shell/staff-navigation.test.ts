import { describe, expect, it } from "vitest";

import { sessionRolesFor, type Role } from "@clockwork/contracts";

import { translatorFor } from "@/src/i18n/catalogs";

import { getCommandItems } from "./command-items";
import {
  canAccessNavigationItem,
  navigation,
  roleCanAccess,
  salesNavigation,
} from "./navigation";

const t = translatorFor("en");
const salesHrefs = salesNavigation.map(({ href }) => href as string);

function visibleHrefs(granted: Role, providerBacked = true): string[] {
  const roles = sessionRolesFor([granted]);
  return navigation.internal
    .filter((item) => !item.providerBackedOnly || providerBacked)
    .filter((item) => canAccessNavigationItem(item, roles))
    .map(({ href }) => href);
}

describe("staff navigation by role", () => {
  it("shows a seller the sales workspace and nothing else", () => {
    expect(visibleHrefs("revenue")).toEqual([
      "/internal",
      "/internal/mndas",
      "/internal/contracts",
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

  it("reserves the team page for the commerce administrator", () => {
    expect(visibleHrefs("commerce_admin")).toContain("/internal/team");
    for (const role of [
      "internal_operator",
      "finance_approver",
      "legal_approver",
      "revenue",
    ] as const)
      expect(visibleHrefs(role)).not.toContain("/internal/team");
  });

  it("gives an operations-only role no sales group", () => {
    const hrefs = visibleHrefs("destructive_action_approver");
    expect(hrefs.some((href) => salesHrefs.includes(href))).toBe(false);
    expect(hrefs).toContain("/internal/operations");
  });

  it("hides the MNDA register where no live register exists", () => {
    expect(visibleHrefs("revenue", false)).toEqual([
      "/internal",
      "/internal/pricing",
    ]);
  });

  it("admits both new roles to the staff portal and no tenant role", () => {
    expect(roleCanAccess("internal", "revenue")).toBe(true);
    expect(roleCanAccess("internal", "commerce_admin")).toBe(true);
    expect(roleCanAccess("internal", "owner")).toBe(false);
    expect(roleCanAccess("customer", "revenue")).toBe(false);
  });
});

describe("staff command palette", () => {
  const search = (granted: Role, term: string) =>
    getCommandItems(
      "internal",
      sessionRolesFor([granted]),
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

  it("finds indicative pricing", () => {
    expect(search("revenue", "pricing")).toContain("/internal/pricing");
    expect(search("revenue", "quote")).toContain("/internal/pricing");
  });

  it("offers a seller no operations command", () => {
    const hrefs = getCommandItems(
      "internal",
      ["revenue"],
      { providerBacked: true },
      t,
    ).map((item) => item.href);
    expect(hrefs.every((href) => href && salesHrefs.includes(href))).toBe(true);
  });
});
