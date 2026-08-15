import { expect, test, type Page } from "@playwright/test";

/**
 * Keyboard and assistive-technology behaviour that a scanner cannot see.
 *
 * Every failure covered here passed axe: a skip link that scrolls without
 * moving focus, a route change that announces nothing, a table whose semantics
 * are removed by a media query, a scroll container with no way in from the
 * keyboard, and a field that drops characters. They are pinned in a browser
 * because none of them reproduces in jsdom -- the first four are decided by
 * computed style and real focus, and the last by the timing of a client
 * transition.
 */

async function usePersona(page: Page, role: string) {
  await page.setExtraHTTPHeaders({ "x-clockwork-persona": role });
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        body: document.body.scrollWidth - document.body.clientWidth,
        document:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      })),
    )
    .toEqual({ body: 0, document: 0 });
}

function activeElement(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element) return null;
    return {
      id: element.id,
      tag: element.tagName.toLowerCase(),
      inMain: Boolean(element.closest("#main-content")),
      text: (element.textContent ?? "").trim().slice(0, 40),
    };
  });
}

test.describe("keyboard wayfinding", () => {
  test.beforeEach(async ({ page }) => usePersona(page, "internal_operator"));

  test("the skip link moves focus into the main landmark, not just the scroll position", async ({
    page,
  }) => {
    await page.goto("/internal/queues");
    await expect(
      page.getByRole("heading", { level: 1, name: "Operational queues" }),
    ).toBeVisible();

    // First stop from the top of the document.
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Skip to main content" }),
    ).toBeFocused();

    await page.keyboard.press("Enter");

    expect(await activeElement(page)).toMatchObject({ id: "main-content" });

    // And the next Tab continues from the content rather than from the header.
    await page.keyboard.press("Tab");
    expect(await activeElement(page)).toMatchObject({ inMain: true });
  });

  test("a client transition announces the destination", async ({ page }) => {
    await page.goto("/internal");
    const live = page.locator(".cw-shell__banner [aria-live='polite']");
    await expect(live).toHaveCount(1);

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Reports", exact: true })
      .click();

    await expect(page).toHaveURL(/\/internal\/reports$/);
    await expect(live).toHaveText(/Page loaded\./);
  });
});

test.describe("operator queue table at a narrow viewport", () => {
  test.beforeEach(async ({ page }) => usePersona(page, "internal_operator"));

  test("keeps the table semantics and the column headers", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/internal/queues");
    const table = page.getByRole("table");
    await expect(table).toBeVisible();

    // A browser derives the table roles from the computed display value, so a
    // responsive layout that switches the table to a grid removes them.
    expect(
      await table.evaluate((element) => getComputedStyle(element).display),
    ).toBe("table");
    await expect(table.getByRole("columnheader")).toHaveCount(6);
    await expect(
      table.getByRole("columnheader", { name: "SLA" }),
    ).toBeAttached();

    await expectNoHorizontalOverflow(page);
  });

  test("lets the keyboard scroll the table container", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/internal/queues");
    const scroller = page.getByRole("region", { name: "Queue results table" });
    await expect(scroller).toBeVisible();

    const overflowing = await scroller.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    );
    expect(
      overflowing,
      "the fixture must overflow for this to be a scroll test",
    ).toBe(true);

    await scroller.focus();
    await expect(scroller).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
  });
});

test.describe("operator search input", () => {
  test.beforeEach(async ({ page }) => usePersona(page, "internal_operator"));

  test("keeps every character typed into the queue filter", async ({
    page,
  }) => {
    await page.goto("/internal/queues");
    const field = page.getByLabel("Search work");
    await field.click();
    await field.pressSequentially("collections", { delay: 25 });

    await expect(field).toHaveValue("collections");
    await expect(page).toHaveURL(/q=collections/);
    await expect(field).toHaveValue("collections");
  });

  test("moves real focus through global search results and claims no virtual cursor", async ({
    page,
  }) => {
    await page.goto("/internal/search?q=collections");
    const field = page.getByRole("searchbox", {
      name: "Search accounts, records, and documents",
    });
    await expect(field).toBeFocused();
    await expect(field).not.toHaveAttribute("aria-activedescendant", /.*/);

    await page.keyboard.press("ArrowDown");

    await expect(
      page.getByRole("link", { name: "Collections aging decision" }).first(),
    ).toBeFocused();
    await expect(field).not.toHaveAttribute("aria-activedescendant", /.*/);

    await page.keyboard.press("Escape");
    await expect(field).toBeFocused();
  });
});
