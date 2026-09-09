import { expect, test } from "@playwright/test";
import { catalogs, type Locale } from "../src/i18n";

// Visits use separate browser contexts: a preference must never become global.
for (const language of Object.keys(catalogs) as Locale[]) {
  test(`saved ${language} preference survives navigation and reload`, async ({
    page,
    context,
  }) => {
    const copy = catalogs[language];
    await page.goto("/settings");
    await page.locator('select[name="language"]').selectOption(language);
    await page
      .getByRole("button", { name: "Save language", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: copy["settings.title"], exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: copy["settings.saved"] }),
    ).toBeVisible();
    const cookie = (await context.cookies()).find(
      (cookie) => cookie.name === "clockwork-language",
    );
    expect(cookie).toMatchObject({
      value: language,
      httpOnly: true,
      sameSite: "Lax",
    });
    await page.reload();
    await expect(page.locator('select[name="language"]')).toHaveValue(language);
    await page.goto("/internal");
    await expect(
      page.getByRole("heading", { name: copy["ui.0"], exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      language === "ar" ? "rtl" : "ltr",
    );
    await expect(
      page
        .getByRole("link", { name: copy["nav.internal.search"], exact: true })
        .first(),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: copy["settings.title"], exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/language-${language}-mobile.png`,
      fullPage: true,
    });
    await page.locator('select[name="language"]').selectOption("en");
    await page
      .getByRole("button", { name: copy["settings.save"], exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
  });
}

test("parallel requests do not share a language", async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Browser test baseURL is required");
  const spanish = await browser.newContext();
  const french = await browser.newContext();
  try {
    await spanish.addCookies([
      { name: "clockwork-language", value: "es", url: baseURL },
    ]);
    await french.addCookies([
      { name: "clockwork-language", value: "fr", url: baseURL },
    ]);
    const a = await spanish.newPage(),
      b = await french.newPage();
    await Promise.all([
      a.goto(`${baseURL}/settings`),
      b.goto(`${baseURL}/settings`),
    ]);
    await expect(
      a.getByRole("heading", { name: "Configuración", exact: true }),
    ).toBeVisible();
    await expect(
      b.getByRole("heading", { name: "Paramètres", exact: true }),
    ).toBeVisible();
  } finally {
    await spanish.close();
    await french.close();
  }
});
