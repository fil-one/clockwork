import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRoles, type Role } from "@clockwork/contracts";

import { AppShell } from "./app-shell";
import type { RouteSession } from "./route-session";

let pathname = "/internal";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock("@/src/auth/actions", () => ({
  switchCommerceAccount: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock("@/src/auth/sign-out", () => ({ signOutCommerceSession: vi.fn() }));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

function sessionFor(granted: Role): RouteSession {
  return {
    roles: [granted],
    permissions: permissionsForRoles([granted], { side: "fil_one" }),
    profile: { name: "Priya Raman", email: "priya.raman@fil.one" },
    locale: "en-US",
    timeZone: "UTC",
    memberships: [
      {
        userId: "20000000-0000-4000-8000-000000000010",
        userName: "Priya Raman",
        userEmail: "priya.raman@fil.one",
        isInternalStaff: true,
        organizationId: "30000000-0000-4000-8000-000000000008",
        workosOrganizationId: "org_local_staff",
        organizationName: "Fil One LLC",
        accountId: "10000000-0000-4000-8000-000000000008",
        accountName: "Fil One LLC",
        role: granted,
        roles: [granted],
        side: "fil_one",
        audience: "internal",
        home: "/internal",
      },
    ],
    selectedAccountId: "10000000-0000-4000-8000-000000000008",
    effectiveAccountId: "10000000-0000-4000-8000-000000000008",
    providerBacked: true,
    authenticationSource: "workos",
  };
}

function renderRail(granted: Role) {
  render(
    <AppShell audience="internal" session={sessionFor(granted)}>
      <main id="main-content">
        <h1>Page</h1>
      </main>
    </AppShell>,
  );
  return screen.getAllByRole("navigation", {
    name: "Primary navigation",
  })[0] as HTMLElement;
}

describe("staff rail", () => {
  beforeEach(() => {
    pathname = "/internal";
  });

  it("gives a seller one Sales group with home, MNDAs, contracts, partners, library and pricing", () => {
    const rail = renderRail("revenue");
    const links = within(rail)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(links).toEqual([
      expect.stringContaining("Home"),
      expect.stringContaining("MNDAs"),
      expect.stringContaining("Contracts"),
      expect.stringContaining("Partners"),
      expect.stringContaining("Sales library"),
      expect.stringContaining("Pricing"),
    ]);
    expect(within(rail).getByText("Sales")).toBeInTheDocument();
    expect(within(rail).queryByText("Operations")).not.toBeInTheDocument();
  });

  it("puts operations behind closed groups for a commerce administrator", () => {
    const rail = renderRail("commerce_admin");
    expect(within(rail).getByRole("link", { name: /Team/u })).toBeVisible();
    const operations = within(rail).getByText("Operations").closest("details");
    expect(operations).not.toBeNull();
    expect(operations).not.toHaveAttribute("open");
    expect(
      within(operations as HTMLElement).getByRole("link", {
        name: /Operations health/u,
        hidden: true,
      }),
    ).toHaveAttribute("href", "/internal/operations");
  });

  it("puts handoffs and organizations in the operations group, with icons", () => {
    const rail = renderRail("commerce_admin");
    const operations = within(rail)
      .getByText("Operations")
      .closest("details") as HTMLElement;
    const links = within(operations)
      .getAllByRole("link", { hidden: true })
      .map((link) => link.getAttribute("href"));
    expect(links).toEqual([
      "/internal/operations",
      "/internal/handoffs",
      "/internal/organizations",
      "/internal/search",
      "/internal/assisted",
    ]);
    for (const name of [/Handoffs/u, /Organizations/u])
      expect(
        within(operations)
          .getByRole("link", { name, hidden: true })
          .querySelector("svg"),
      ).not.toBeNull();
  });

  it("opens the operations group for an operator", () => {
    const rail = renderRail("internal_operator");
    expect(within(rail).getByText("Sales")).toBeInTheDocument();
    const operations = within(rail).getByText("Operations").closest("details");
    expect(operations).toHaveAttribute("open");
    expect(within(rail).getByRole("link", { name: /Handoffs/u })).toBeVisible();
  });

  it("opens the operations group that holds the current page", () => {
    pathname = "/internal/webhook-replay";
    const rail = renderRail("commerce_admin");
    const current = within(rail).getByRole("link", {
      name: /Webhook replay/u,
    });
    expect(current.closest("details")).toHaveAttribute("open");
    expect(current).toHaveAttribute("aria-current", "page");
  });

  it("shows staff no customer or partner organization switcher", () => {
    renderRail("commerce_admin");
    expect(screen.queryByLabelText(/Switch organization/u)).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("points a seller's help at the start guide, not operating guidance", () => {
    renderRail("revenue");
    expect(screen.getByRole("link", { name: "Start guide" })).toHaveAttribute(
      "href",
      "/internal",
    );
  });

  it("keeps operating guidance as help for operations staff", () => {
    renderRail("commerce_admin");
    expect(
      screen.getByRole("link", {
        name: "External gates and operating guidance",
      }),
    ).toHaveAttribute("href", "/internal/gates");
  });
});
