import { expect, type Page } from "@playwright/test";

/**
 * Wait for the experience shell to attach its event handlers.
 *
 * A visible control is server-rendered markup. Its click handler exists only
 * once React has attached, and a click or a fill issued before that is written
 * to markup no component is listening to and is silently lost: the surface
 * never changes, and the next expectation waits out its whole budget for a
 * confirmation nothing is producing. Three consecutive `demo` shards on main
 * failed that way, a different journey each time, all of them at a
 * `toBeVisible` on the result of an interaction rather than at the interaction
 * itself. The shell sets `data-hydrated` from a mount effect, so it is the
 * signal that the handlers exist.
 *
 * Every document load needs it: a `goto`, a `reload`, and a redirect that lands
 * on a fresh surface. A client transition inside the shell does not, because
 * React renders and attaches that surface in one commit. A load followed only
 * by assertions does not either -- the assertion is already waiting for the
 * thing it is about.
 *
 * This is the shell's marker, so it covers the surfaces the shell wraps, which
 * is every route under `app/(experience)`. The pages outside it -- the demo
 * gate, registration, the signing ceremony -- carry their own signal, and their
 * specs wait on it: `/register` strips its one-time code from the address bar
 * from a mount effect, and the signing form disables its submit until mounted.
 */
export async function expectShellHydrated(page: Page) {
  await expect(page.locator(".experience-shell")).toHaveAttribute(
    "data-hydrated",
    "true",
  );
}

export async function gotoHydrated(page: Page, destination: string) {
  await page.goto(destination);
  await expectShellHydrated(page);
}

export async function reloadHydrated(page: Page) {
  await page.reload();
  await expectShellHydrated(page);
}
