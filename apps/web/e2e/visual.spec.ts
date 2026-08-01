import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const desktopSurfaces = [
  { name: "customer-dashboard", path: "/dashboard" },
  { name: "partner-agreement-clock", path: "/partner" },
  { name: "operator-priority-work", path: "/internal/queues" },
] as const;

const commercialSurfaces = [
  {
    name: "customer-quote-workspace",
    path: "/quotes/new",
    heading: "Quote workspace",
  },
  {
    name: "customer-order-acceptance",
    path: "/orders/accept",
    heading: "Order acceptance",
  },
] as const;

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

async function expectAxeClean(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}

for (const surface of desktopSurfaces) {
  test(`visual ${surface.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(surface.path);
    await expect(page.locator(".experience-shell")).toHaveAttribute(
      "data-hydrated",
      "true",
    );
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`${surface.name}.png`, {
      animations: "disabled",
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });
}

for (const surface of commercialSurfaces) {
  test(`visual ${surface.name}`, async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-clockwork-persona": "owner" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(surface.path);
    await expect(page.locator(".experience-shell")).toHaveAttribute(
      "data-hydrated",
      "true",
    );
    await expect(
      page.getByRole("heading", { level: 1, name: surface.heading }),
    ).toBeVisible();
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`${surface.name}.png`, {
      animations: "disabled",
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });

  test(`visual ${surface.name} at 320px`, async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-clockwork-persona": "owner" });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(surface.path);
    await expect(page.locator(".experience-shell")).toHaveAttribute(
      "data-hydrated",
      "true",
    );
    await expect(
      page.getByRole("heading", { level: 1, name: surface.heading }),
    ).toBeVisible();
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`${surface.name}-320.png`, {
      animations: "disabled",
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });
}

test("visual customer dashboard at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/dashboard");
  await expect(page.locator(".experience-shell")).toHaveAttribute(
    "data-hydrated",
    "true",
  );
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot("customer-dashboard-320.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.01,
  });
});

for (const viewport of [
  { label: "desktop", width: 1440, height: 1000 },
  { label: "320", width: 320, height: 800 },
] as const) {
  test(`visual reachable state gallery at ${viewport.label}`, async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({ "x-clockwork-persona": "owner" });
    await page.setViewportSize(viewport);
    await page.goto("/states");
    await expect(page.locator(".experience-shell")).toHaveAttribute(
      "data-hydrated",
      "true",
    );
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Every state has a safe next step",
      }),
    ).toBeVisible();
    await expect(page.locator(".cw-state")).toHaveCount(11);
    await expectNoHorizontalOverflow(page);
    await expectAxeClean(page);
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(
      `customer-state-gallery${viewport.label === "320" ? "-320" : ""}.png`,
      {
        animations: "disabled",
        fullPage: true,
        maxDiffPixelRatio: 0.01,
      },
    );
  });
}

for (const viewport of [
  { label: "1440", width: 1440, height: 1000 },
  { label: "768", width: 768, height: 1024 },
  { label: "320", width: 320, height: 800 },
] as const) {
  test(`approval surfaces pass Axe and reflow at ${viewport.label}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    for (const surface of desktopSurfaces) {
      await page.goto(surface.path);
      await expect(page.locator("#main-content h1")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectAxeClean(page);
    }
  });
}

for (const viewport of [
  { label: "1440", width: 1440, height: 1000 },
  { label: "768", width: 768, height: 1024 },
  { label: "320", width: 320, height: 800 },
] as const) {
  test(`commercial quote and order pass Axe and reflow at ${viewport.label}px`, async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({ "x-clockwork-persona": "owner" });
    await page.setViewportSize(viewport);
    for (const surface of commercialSurfaces) {
      await page.goto(surface.path);
      await expect(
        page.getByRole("heading", { level: 1, name: surface.heading }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectAxeClean(page);
    }
  });
}

test("approval surfaces preserve content at 200% zoom and 400% reflow equivalents", async ({
  page,
}) => {
  for (const equivalent of [
    { label: "200%", width: 640, height: 720 },
    { label: "400%", width: 320, height: 720 },
  ] as const) {
    await page.setViewportSize(equivalent);
    for (const surface of desktopSurfaces) {
      await page.goto(surface.path);
      await expect(page.locator("#main-content h1")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expect(
        page.locator("#main-content"),
        `${surface.name} must retain its primary content at ${equivalent.label}`,
      ).not.toBeEmpty();
    }
  }
});

test("approval surfaces tolerate WCAG text spacing overrides", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  for (const surface of desktopSurfaces) {
    await page.goto(surface.path);
    await page.addStyleTag({
      content: `
        * {
          line-height: 1.5 !important;
          letter-spacing: 0.12em !important;
          word-spacing: 0.16em !important;
        }
        p { margin-bottom: 2em !important; }
      `,
    });
    await expect(page.locator("#main-content h1")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test("approval surfaces honor reduced motion and retain keyboard focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const surface of desktopSurfaces) {
    await page.goto(surface.path);
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    expect(await skipLink.evaluate((element) => element.tabIndex)).toBe(0);
    await skipLink.focus();
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toHaveCSS("outline-style", "solid");
    const nonessentialMotion = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((animation) => animation.playState === "running")
        .map((animation) => {
          const timing = animation.effect?.getComputedTiming();
          return { duration: timing?.duration, iterations: timing?.iterations };
        })
        .filter(
          ({ duration, iterations }) =>
            duration !== 0 && iterations !== 0 && iterations !== 1,
        ),
    );
    expect(nonessentialMotion).toEqual([]);
  }
});
