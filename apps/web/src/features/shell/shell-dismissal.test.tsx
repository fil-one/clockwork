import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./app-shell";
import type { RouteSession } from "./route-session";

const push = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/internal",
  useRouter: () => ({ push, replace, prefetch: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/src/auth/actions", () => ({
  switchCommerceAccount: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock("@/src/auth/sign-out", () => ({
  signOutCommerceSession: vi.fn(),
}));

// Radix positions the drawer tooltips with Popper, which observes the trigger.
// jsdom ships no ResizeObserver, so the fixture supplies an inert one.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const session: RouteSession = {
  roles: ["internal_operator"],
  profile: { name: "Demo internal operator", email: "operator@filone.test" },
  locale: "en-US",
  timeZone: "UTC",
  memberships: [
    {
      userId: "20000000-0000-4000-8000-000000000001",
      userName: "Demo internal operator",
      userEmail: "operator@filone.test",
      isInternalStaff: true,
      organizationId: "30000000-0000-4000-8000-000000000008",
      workosOrganizationId: "org_local_clockwork_staff",
      organizationName: "Fil One Staff",
      accountId: "10000000-0000-4000-8000-000000000008",
      accountName: "Fil One Internal Operations",
      role: "internal_operator",
      audience: "internal",
      home: "/internal",
    },
  ],
  selectedAccountId: "10000000-0000-4000-8000-000000000008",
  effectiveAccountId: "10000000-0000-4000-8000-000000000008",
  providerBacked: false,
  authenticationSource: "local",
};

function renderShell() {
  return render(
    <AppShell audience="internal" session={session}>
      <p>Operator content</p>
    </AppShell>,
  );
}

/**
 * Escape dismissal is task-critical on every shell overlay, and the overlays
 * are independent implementations: the drawer is a Radix dialog, the profile
 * popover is a controlled element in this app. Radix arms its Escape handler
 * only on the highest dismissable layer, so a second overlay opening on top of
 * the drawer silently disarms the drawer's own handler. Both are pinned here.
 */
describe("shell overlay dismissal", () => {
  beforeEach(() => {
    push.mockClear();
    replace.mockClear();
  });

  it("closes the navigation drawer on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    renderShell();

    const trigger = screen.getByRole("button", { name: "Open navigation" });
    await user.click(trigger);
    expect(
      await screen.findByRole("dialog", { name: "Navigation" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Navigation" }),
      ).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("closes the navigation drawer on Escape when it was opened from the keyboard", async () => {
    const user = userEvent.setup();
    renderShell();

    const trigger = screen.getByRole("button", { name: "Open navigation" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("dialog", { name: "Navigation" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Navigation" }),
      ).not.toBeInTheDocument(),
    );
  });

  /**
   * The drawer closes inside the same click handler that starts the route
   * transition, which unmounts the portal — and the link — while the
   * transition is in flight. P0-34 reported that as the drawer navigating
   * nowhere, so the order is pinned here: every drawer link hands its href to
   * the router, and only then does the drawer close.
   */
  it("routes from every drawer link before the drawer closes", async () => {
    const user = userEvent.setup();
    renderShell();

    const trigger = screen.getByRole("button", { name: "Open navigation" });
    const openDrawer = async () => {
      await user.click(trigger);
      return screen.findByRole("dialog", { name: "Navigation" });
    };
    const closed = () =>
      waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Navigation" }),
        ).not.toBeInTheDocument(),
      );

    // The pathname is fixed for this render, so the destination order does not
    // move between openings and an index is a stable handle on each link.
    const hrefs = within(await openDrawer())
      .getAllByRole("link")
      .map((link) => link.getAttribute("href") ?? "");
    expect(hrefs.length).toBeGreaterThan(1);
    await user.keyboard("{Escape}");
    await closed();

    for (const [index, href] of hrefs.entries()) {
      const drawer = await openDrawer();
      const link = within(drawer).getAllByRole("link")[index];
      expect(link, `drawer link ${index} disappeared`).toBeDefined();
      push.mockClear();
      await user.click(link as HTMLElement);
      expect(push).toHaveBeenCalledWith(href);
      await closed();
    }
  });

  it("closes the profile popover on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    renderShell();

    const trigger = screen.getByRole("button", { name: "Open profile menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("operator@filone.test")).toBeVisible();

    await user.keyboard("{Escape}");

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("operator@filone.test")).not.toBeVisible();
    expect(trigger).toHaveFocus();
  });

  it("closes the profile popover when a pointer lands outside it", async () => {
    const user = userEvent.setup();
    renderShell();

    const trigger = screen.getByRole("button", { name: "Open profile menu" });
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByText("Operator content"));

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("operator@filone.test")).not.toBeVisible();
  });
});
