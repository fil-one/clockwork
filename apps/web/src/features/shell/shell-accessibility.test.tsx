import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./app-shell";
import type { RouteSession } from "./route-session";

const push = vi.fn();
const replace = vi.fn();

let pathname = "/internal";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push, replace, prefetch: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/src/auth/actions", () => ({
  switchCommerceAccount: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock("@/src/auth/sign-out", () => ({
  signOutCommerceSession: vi.fn(),
}));

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

/**
 * Every route renders its own `<main id="main-content">` inside the shell --
 * forty-four of them across the app -- so the fixture reproduces that shape
 * rather than letting the structural shell own the target.
 */
function renderShell() {
  return render(
    <AppShell audience="internal" session={session}>
      <main id="main-content">
        <h1>Operational queues</h1>
        <p>Operator content</p>
      </main>
    </AppShell>,
  );
}

describe("shell keyboard and screen reader wayfinding", () => {
  beforeEach(() => {
    pathname = "/internal";
    push.mockClear();
    replace.mockClear();
  });

  /**
   * The skip link is the only control offering to move a keyboard user past
   * the header and the rail. Following a fragment moves the viewport, but it
   * moves focus only when the target can hold it, and a landmark cannot: the
   * link used to leave the caret and the screen reader cursor exactly where
   * they were, so the next Tab went back to the second header control.
   */
  it("moves real focus onto the page's main landmark", async () => {
    const user = userEvent.setup();
    renderShell();

    const skip = screen.getByRole("link", { name: "Skip to main content" });
    const main = document.getElementById("main-content");
    expect(main).not.toBeNull();

    await user.click(skip);

    expect(document.activeElement).toBe(main);
  });

  /**
   * The landmark is focusable only while it holds focus. A permanently
   * focusable target is picked up by the App Router's own post-navigation
   * `focus()` call, which would pull focus into the content on every client
   * transition and take it from controls that restore it deliberately.
   */
  it("leaves no permanent tab stop on the landmark", async () => {
    const user = userEvent.setup();
    renderShell();

    const main = document.getElementById("main-content") as HTMLElement;
    expect(main.hasAttribute("tabindex")).toBe(false);

    await user.click(
      screen.getByRole("link", { name: "Skip to main content" }),
    );
    expect(main.getAttribute("tabindex")).toBe("-1");

    main.blur();
    await waitFor(() => expect(main.hasAttribute("tabindex")).toBe(false));
  });

  /**
   * A client transition swaps the content with no document load, so without an
   * announcement a screen reader user is given no signal that the route
   * changed at all.
   */
  it("announces the destination after a client transition", async () => {
    const { rerender } = renderShell();
    const liveRegions = document.querySelectorAll("[aria-live]");
    expect(liveRegions).toHaveLength(1);
    const live = liveRegions[0] as HTMLElement;

    // The first render is the document load, which the browser announces, so
    // nothing about the route goes through the region. The connection state
    // this region already carries is the only thing in it.
    expect(live.textContent).not.toContain("Page loaded");

    pathname = "/internal/reports";
    rerender(
      <AppShell audience="internal" session={session}>
        <main id="main-content">
          <h1>Operational reports</h1>
        </main>
      </AppShell>,
    );

    await waitFor(() =>
      expect(live.textContent).toBe("Operational reports. Page loaded."),
    );
    // Still one region: the connection and organization messages share it.
    expect(document.querySelectorAll("[aria-live]")).toHaveLength(1);
  });

  it("names the destination from the rail when the page has no heading yet", async () => {
    const { rerender } = renderShell();

    pathname = "/internal/search";
    rerender(
      <AppShell audience="internal" session={session}>
        <main id="main-content" />
      </AppShell>,
    );

    await waitFor(() =>
      expect(
        (document.querySelector("[aria-live]") as HTMLElement).textContent,
      ).toBe("Global search. Page loaded."),
    );
  });
});
