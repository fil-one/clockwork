import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { applyPersona } from "@clockwork/testing/playwright";
import { demoAccountIds } from "@clockwork/testing/personas";

const customerDestinations = [
  "Overview",
  "Agreements",
  "Quotes",
  "Orders",
  "Active services",
  "POCs",
  "Billing",
  "Amendments",
  "Marketplace",
  "Support",
  "Account",
] as const;

const partnerAdminDestinations = [
  "Partner desk",
  "End clients",
  "Deal registration",
  "Partner quotes",
  "Consolidated billing",
  "Commissions",
  "Renewals",
  "Disputes",
  "Marketplace",
  "Sandboxes & POCs",
  "Brand & domains",
  "Support",
] as const;

const viewports = [
  { name: "desktop", width: 1440, height: 1000, mobile: false },
  { name: "compact-desktop", width: 1024, height: 768, mobile: false },
  { name: "tablet", width: 768, height: 1024, mobile: false },
  { name: "mobile-390", width: 390, height: 844, mobile: true },
  { name: "mobile-320", width: 320, height: 800, mobile: true },
] as const;

async function openDashboard(
  page: Page,
  viewport: { width: number; height: number },
) {
  await applyPersona(page, "directOwner");
  await page.setViewportSize(viewport);
  await page.goto("/dashboard");
  await expect(page.locator(".experience-shell")).toHaveAttribute(
    "data-hydrated",
    "true",
  );
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Welcome back",
  );
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

async function expectMinimumTarget(locator: Locator, minimum = 42) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, "the target should have a rendered hit area").not.toBeNull();
  expect(box?.width, "target width").toBeGreaterThanOrEqual(minimum);
  expect(box?.height, "target height").toBeGreaterThanOrEqual(minimum);
}

async function openNavigation(page: Page) {
  const trigger = page.getByRole("button", { name: "Open navigation" });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute("aria-modal", "true");
  return { drawer, trigger };
}

async function openCommandPalette(page: Page) {
  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.getByRole("dialog", { name: "Search and commands" });
  await expect(palette).toBeVisible();
  await expect(palette).toHaveAttribute("aria-modal", "true");
  const search = palette.getByRole("combobox", {
    name: "Search navigation, actions, and records",
  });
  await expect(search).toBeFocused();
  return { palette, search };
}

async function expectFocusContained(page: Page, container: Locator) {
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab");
    expect(
      await container.evaluate((node) => node.contains(document.activeElement)),
      `focus escaped the modal after ${index + 1} Tab presses`,
    ).toBe(true);
  }
  await page.keyboard.press("Shift+Tab");
  expect(
    await container.evaluate((node) => node.contains(document.activeElement)),
    "focus escaped the modal after Shift+Tab",
  ).toBe(true);
}

for (const viewport of viewports) {
  test(`${viewport.name} keeps every destination discoverable without horizontal overflow`, async ({
    page,
  }) => {
    await openDashboard(page, viewport);

    let navigation: Locator;
    if (viewport.mobile) {
      const trigger = page.getByRole("button", { name: "Open navigation" });
      await expectMinimumTarget(trigger);
      ({ drawer: navigation } = await openNavigation(page));
    } else {
      navigation = page.getByRole("navigation", {
        name: "Primary navigation",
      });
      await expect(navigation).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Open navigation" }),
      ).toBeHidden();
    }

    for (const destination of customerDestinations) {
      const link = navigation.getByRole("link", {
        name: destination,
        exact: true,
      });
      await expect(link).toBeVisible();
      await expectMinimumTarget(link);
    }
    await expect(
      navigation.getByRole("link", { name: "Overview", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expectNoHorizontalOverflow(page);

    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
  });
}

for (const viewport of viewports.filter((candidate) => candidate.mobile)) {
  test(`${viewport.name} drawer is modal, keyboard trapped, and restores focus`, async ({
    page,
  }) => {
    await openDashboard(page, viewport);
    const { drawer, trigger } = await openNavigation(page);

    await expect(
      drawer.getByText("Browse every destination.", { exact: true }),
    ).toBeVisible();
    const backgroundIsBlocked = await page
      .locator("#main-content")
      .evaluate((main) => {
        let current: HTMLElement | null = main as HTMLElement;
        while (current && current !== document.body) {
          if (
            current.hasAttribute("inert") ||
            current.getAttribute("aria-hidden") === "true"
          ) {
            return true;
          }
          current = current.parentElement;
        }
        return getComputedStyle(document.body).pointerEvents === "none";
      });
    expect(
      backgroundIsBlocked,
      "the modal must block background interaction",
    ).toBe(true);
    await expectFocusContained(page, drawer);

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();

    const reopened = await openNavigation(page);
    await reopened.drawer
      .getByRole("link", { name: "Agreements", exact: true })
      .click();
    await expect(page).toHaveURL(/\/agreements$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Agreements" }),
    ).toBeVisible();
    await expect(reopened.drawer).toBeHidden();
    await expect(reopened.trigger).toBeFocused();
    await expectNoHorizontalOverflow(page);
  });
}

/**
 * The drawer closes inside the navigation click handler, so the portal unmounts
 * the link the click came from while the route transition is still in flight.
 * P0-34 reported that as the drawer navigating nowhere. One link is a weak
 * witness for a race, so every destination is walked: each has to land on its
 * own href, close the drawer, and hand focus back to the trigger.
 */
test("every mobile drawer destination commits its route", async ({ page }) => {
  test.setTimeout(120_000);
  const viewport = viewports[4];
  for (const destination of customerDestinations) {
    await openDashboard(page, viewport);
    const { drawer, trigger } = await openNavigation(page);
    const link = drawer.getByRole("link", { name: destination, exact: true });
    const href = await link.getAttribute("href");
    expect(href, `${destination} must carry a destination`).toBeTruthy();
    await link.click();
    await page.waitForURL((url) => url.pathname === href);
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  }
});

test("partner admin can reach every partner destination from the 320px drawer", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({
    "x-clockwork-persona": "partner_admin",
  });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/partner");
  const { drawer } = await openNavigation(page);

  for (const destination of partnerAdminDestinations) {
    await expectMinimumTarget(
      drawer.getByRole("link", { name: destination, exact: true }),
    );
  }
  await expectNoHorizontalOverflow(page);
});

test("partner seller navigation and commands exclude admin-only work", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({
    "x-clockwork-persona": "partner_seller",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/partner");
  const { drawer } = await openNavigation(page);

  await expect(
    drawer.getByRole("link", { name: "Support", exact: true }),
  ).toBeVisible();
  for (const destination of [
    "Consolidated billing",
    "Commissions",
    "Renewals",
    "Sandboxes & POCs",
    "Brand & domains",
  ]) {
    await expect(
      drawer.getByRole("link", { name: destination, exact: true }),
    ).toHaveCount(0);
  }

  await page.keyboard.press("Escape");
  const { palette, search } = await openCommandPalette(page);
  await search.fill("billing");
  await expect(
    palette.getByText("No results found", { exact: false }),
  ).toBeVisible();
});

test("command palette supports grouped search, no matches, and focus restoration", async ({
  page,
}) => {
  await openDashboard(page, viewports[0]);
  const trigger = page.getByRole("button", { name: "Open command menu" });
  await expectMinimumTarget(trigger);

  let { palette, search } = await openCommandPalette(page);
  for (const group of ["Navigation", "Actions"] as const) {
    await expect(
      palette.getByRole("heading", { name: group, exact: true }),
    ).toBeVisible();
  }
  await expect(
    palette.getByText("Build a quote", { exact: true }),
  ).toBeVisible();
  await expect(
    palette.getByRole("heading", { name: "Records", exact: true }),
  ).toHaveCount(0);
  await expect(palette.getByText(/INV-2026-0781/)).toHaveCount(0);
  await expect(palette.getByText("Global search", { exact: true })).toHaveCount(
    0,
  );
  await expectFocusContained(page, palette);
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(trigger).toBeFocused();

  ({ palette, search } = await openCommandPalette(page));
  await search.fill("not-a-clockwork-result");
  await expect(palette.getByRole("status")).toContainText(/No results/i);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  ({ search } = await openCommandPalette(page));
  await search.fill("Agreements");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/agreements$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Agreements" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Search and commands" }),
  ).toBeHidden();
});

test("command palette remains keyboard operable and contained at 320px", async ({
  page,
}) => {
  await openDashboard(page, viewports[3]);
  const trigger = page.getByRole("button", { name: "Open command menu" });
  await trigger.click();
  const palette = page.getByRole("dialog", { name: "Search and commands" });
  await expect(palette).toBeVisible();
  await expectFocusContained(page, palette);
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

for (const viewport of viewports.filter((candidate) => candidate.mobile)) {
  test(`${viewport.name} organization switcher is usable in a compact header`, async ({
    page,
  }) => {
    await openDashboard(page, viewport);
    const organization = page.getByRole("combobox", {
      name: "Switch organization",
      exact: true,
    });
    await expectMinimumTarget(organization);
    await expect(organization).toHaveValue(demoAccountIds.direct);
    await expectNoHorizontalOverflow(page);
    await applyPersona(page, "partnerAdmin");
    await organization.selectOption(demoAccountIds.reseller);
    await expect(page).toHaveURL(/\/partner$/);
    await expect(organization).toHaveValue(demoAccountIds.reseller);

    const header = page.locator("header").filter({ has: organization }).first();
    const box = await header.boundingBox();
    expect(box, "the application header should render").not.toBeNull();
    expect(box?.height, "mobile header height").toBeLessThanOrEqual(160);
  });
}

test("reduced-motion preference removes nonessential shell motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDashboard(page, viewports[0]);
  await page.getByRole("button", { name: "Open command menu" }).click();
  await expect(
    page.getByRole("dialog", { name: "Search and commands" }),
  ).toBeVisible();

  const excessiveMotion = await page.evaluate(() => {
    const durationInMilliseconds = (value: string) =>
      value.split(",").map((part) => {
        const duration = part.trim();
        return duration.endsWith("ms")
          ? Number.parseFloat(duration)
          : Number.parseFloat(duration) * 1000;
      });
    return [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => element.getClientRects().length > 0)
      .flatMap((element) => {
        const styles = getComputedStyle(element);
        const durations = [
          ...durationInMilliseconds(styles.transitionDuration),
          ...durationInMilliseconds(styles.animationDuration),
        ];
        return durations.some((duration) => duration > 20)
          ? [
              {
                element: element.className || element.tagName,
                animationDuration: styles.animationDuration,
                transitionDuration: styles.transitionDuration,
              },
            ]
          : [];
      });
  });
  expect(excessiveMotion).toEqual([]);
});
