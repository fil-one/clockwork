import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * The demo surfaces exist only behind the deploy opt-in and a configured
 * password, which the `demo` release shard mints per run. Release
 * qualification forbids a skipped test, so a missing password fails loudly
 * here rather than reporting an empty suite as coverage.
 */
function configuredPassword(): string {
  const configured = process.env.CLOCKWORK_DEMO_ACCESS_PASSWORD;
  if (!configured)
    throw new Error(
      "The demo suite requires CLOCKWORK_DEMO_ACCESS_PASSWORD. Run it through the demo release shard, or set the variable to drive a demo-configured server.",
    );
  return configured;
}

const password = configuredPassword();

/**
 * The demo Playwright project deliberately runs against `next dev`. A page can
 * finish its document load before the dev runtime connects; capturing in that
 * interval lets Chromium's full-page metrics retain the wordmark's 3,863px
 * intrinsic width even after the stylesheet visibly clamps it. Waiting for the
 * runtime's connection event isolates screenshots from that development-only
 * bootstrap without sleeping or retrying the assertion.
 */
function nextDevRuntimeReady(page: Page) {
  return page.waitForEvent("console", {
    predicate: (message) => message.text() === "[HMR] connected",
  });
}

async function expectVisualLayoutReady(page: Page, viewportWidth: number) {
  const wordmark = page.locator("img.cw-brand-logo[data-mark='wordmark']");
  await expect(wordmark).toBeVisible();
  await wordmark.evaluate(async (image) => {
    if (!(image instanceof HTMLImageElement))
      throw new Error("The demo wordmark must render as an image.");
    await image.decode();
  });
  await page.evaluate(() => document.fonts.ready);

  await expect
    .poll(
      () =>
        page.evaluate(async (expectedWidth) => {
          const measure = () => {
            const main = document.querySelector("main#main-content");
            const logo = document.querySelector<HTMLImageElement>(
              "img.cw-brand-logo[data-mark='wordmark']",
            );
            const stylesLoaded = [...document.styleSheets].every(
              (sheet) => !sheet.href || sheet.ownerNode?.isConnected,
            );
            return {
              stylesLoaded,
              viewportWidth: document.documentElement.clientWidth,
              documentWidth: document.documentElement.scrollWidth,
              mainDisplay: main ? getComputedStyle(main).display : "missing",
              logoWidth: logo?.getBoundingClientRect().width ?? 0,
            };
          };

          const first = measure();
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          const second = measure();
          const ready = (value: ReturnType<typeof measure>) =>
            value.stylesLoaded &&
            value.viewportWidth === expectedWidth &&
            value.documentWidth === expectedWidth &&
            value.mainDisplay === "grid" &&
            value.logoWidth > 0 &&
            value.logoWidth <= 120;
          return (
            ready(first) &&
            ready(second) &&
            first.logoWidth === second.logoWidth
          );
        }, viewportWidth),
      { message: "demo CSS and viewport metrics must settle before capture" },
    )
    .toBe(true);
}

async function expectAxeClean(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}

async function openGate(page: Page, next = "/demo") {
  await page.goto(next);
  await expect(page).toHaveURL(/\/demo\/access/u);
  return page.getByLabel("Password");
}

async function passGate(page: Page, next = "/demo") {
  const field = await openGate(page, next);
  await field.fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
}

test.describe("demo access gate", () => {
  test("refuses the wrong password and keeps the return path", async ({
    page,
  }) => {
    const field = await openGate(page, "/dashboard");
    await field.fill("not-the-password");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page).toHaveURL(/error=1/u);
    await expect(
      page.getByText("That password does not match. Try again."),
    ).toBeVisible();
    // A refused attempt must not carry the visitor past the gate.
    await expect(page).toHaveURL(/\/demo\/access/u);
    await expectAxeClean(page);
  });

  test("opens the landing page on the right password", async ({ page }) => {
    await passGate(page);

    await expect(page).toHaveURL(/\/demo$/u);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Choose the person you are signing in as",
      }),
    ).toBeVisible();
  });
});

test.describe("demo landing", () => {
  test.beforeEach(async ({ page }) => {
    await passGate(page);
  });

  test("groups every persona and starts one", async ({ page }) => {
    await expect(
      page.getByRole("heading", { level: 2, name: "Customers and partners" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Fil One staff" }),
    ).toBeVisible();
    // Nine personas, each its own card with a start link.
    await expect(page.getByRole("link", { name: /^Start as / })).toHaveCount(9);
    await expectAxeClean(page);

    const start = page.getByRole("link", { name: /^Start as / }).first();
    await start.click();
    await expect(page).not.toHaveURL(/\/demo$/u);
    await expect(page.locator(".experience-shell")).toHaveAttribute(
      "data-hydrated",
      "true",
    );
  });

  test("carries the persona into the panel and switches from it", async ({
    page,
  }) => {
    // Mara Voss is the direct buyer, whose journey has two steps, so the list
    // has both a current step and a later one.
    await page.getByRole("link", { name: "Start as Mara Voss" }).click();
    await expect(page.locator(".experience-shell")).toBeVisible();

    await page.getByRole("button", { name: "Open demo controls" }).click();
    const panel = page.getByRole("complementary", { name: "Demo controls" });
    await expect(panel.getByLabel("Signed in as")).toBeVisible();
    // The journey renders as ordered steps with the current one marked.
    await expect(panel.locator("li[data-state]")).not.toHaveCount(0);
    await expect(panel.locator("[aria-current='step']")).toHaveCount(1);

    await panel.getByLabel("Signed in as").selectOption({ index: 1 });
    await expect(page.locator(".experience-shell")).toBeVisible();
  });
});

// The demo pages live behind the password gate, so their baselines are taken
// here rather than in visual.spec.ts, which drives the ungated server.
for (const viewport of [
  { label: "desktop", width: 1440, height: 1000 },
  { label: "320", width: 320, height: 800 },
] as const) {
  test(`visual demo access at ${viewport.label}`, async ({ page }) => {
    const runtimeReady = nextDevRuntimeReady(page);
    await page.setViewportSize(viewport);
    await openGate(page);
    await runtimeReady;
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await expectVisualLayoutReady(page, viewport.width);
    await expect(page).toHaveScreenshot(
      `demo-access${viewport.label === "320" ? "-320" : ""}.png`,
      { animations: "disabled", fullPage: true, maxDiffPixelRatio: 0.01 },
    );
  });

  test(`visual demo landing at ${viewport.label}`, async ({ page }) => {
    const runtimeReady = nextDevRuntimeReady(page);
    await page.setViewportSize(viewport);
    await passGate(page);
    await expect(page.getByRole("link", { name: /^Start as / })).toHaveCount(9);
    await runtimeReady;
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await expectVisualLayoutReady(page, viewport.width);
    await expect(page).toHaveScreenshot(
      `demo-landing${viewport.label === "320" ? "-320" : ""}.png`,
      { animations: "disabled", fullPage: true, maxDiffPixelRatio: 0.01 },
    );
  });
}

test.describe("demo reset", () => {
  test("confirms once and restores seeded data", async ({ page }) => {
    await passGate(page);
    await page
      .getByRole("link", { name: /^Start as / })
      .first()
      .click();
    await expect(page.locator(".experience-shell")).toBeVisible();

    await page.evaluate(() =>
      window.localStorage.setItem("clockwork-demo:probe", "dirty"),
    );

    await page.getByRole("button", { name: "Open demo controls" }).click();
    const panel = page.getByRole("complementary", { name: "Demo controls" });
    // One reset lives in the panel; the sidebar footer no longer carries a copy.
    await expect(
      panel.getByRole("button", { name: "Restore demo data" }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Reset demo", exact: true }),
    ).toHaveCount(0);

    await panel.getByRole("button", { name: "Restore demo data" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Reset demo" }).click();

    // The action clears local state and then reloads, so the probe disappears
    // once the reload settles rather than on the click itself.
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage.getItem("clockwork-demo:probe"),
        ),
      )
      .toBeNull();
    await expect(page.locator(".experience-shell")).toBeVisible();
  });
});
