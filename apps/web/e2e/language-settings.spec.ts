import { expect, test } from "@playwright/test";
import { translatorFor } from "../src/i18n/catalogs";
import { locales } from "../src/i18n/locales";

import { gotoHydrated } from "./shell-hydration";

const english = translatorFor("en");

/**
 * The root layout survives a client-side navigation, so `<html lang dir>` keeps
 * the attributes of the first page loaded unless the staff subtree sets them.
 * An Arabic reader moves between a staff route and `/settings`, which renders
 * in the reader's language, without a document load in either direction.
 */
test("client-side navigation between staff and reader routes switches the document language", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Browser test baseURL is required");
  const t = translatorFor("ar");
  const html = page.locator("html");
  const readerDocument = async () => {
    await expect(
      page.getByRole("heading", { name: t("settings.title"), exact: true }),
    ).toBeVisible();
    await expect(html).toHaveAttribute("dir", "rtl");
    await expect(html).toHaveAttribute("lang", "ar-AE");
  };
  const staffDocument = async () => {
    await expect(
      page.getByRole("heading", {
        name: english("operations.home.title"),
        exact: true,
      }),
    ).toBeVisible();
    await expect(html).toHaveAttribute("dir", "ltr");
    await expect(html).toHaveAttribute("lang", "en");
  };
  await context.addCookies([
    { name: "clockwork-language", value: "ar", url: baseURL },
  ]);
  await gotoHydrated(page, "/internal/operations");
  await staffDocument();
  // A document load would discard this marker.
  await page.evaluate(() => {
    (window as unknown as { sameDocument: boolean }).sameDocument = true;
  });
  const stillSameDocument = () =>
    page.evaluate(
      () => (window as unknown as { sameDocument?: boolean }).sameDocument,
    );

  // Staff to reader: the profile menu's settings link.
  await page
    .getByRole("button", { name: english("app.profile"), exact: true })
    .click();
  await page
    .getByRole("link", { name: english("settings.title"), exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings$/u);
  await readerDocument();
  expect(await stillSameDocument()).toBe(true);

  // Reader to staff, and back again, through history.
  await page.goBack();
  await expect(page).toHaveURL(/\/internal\/operations$/u);
  await staffDocument();
  expect(await stillSameDocument()).toBe(true);

  await page.goForward();
  await expect(page).toHaveURL(/\/settings$/u);
  await readerDocument();
  expect(await stillSameDocument()).toBe(true);
});

// Visits use separate browser contexts: a preference must never become global.
for (const language of locales) {
  test(`saved ${language} preference survives navigation and reload`, async ({
    page,
    context,
  }) => {
    const t = translatorFor(language);
    await gotoHydrated(page, "/settings");
    await page.locator('select[name="language"]').selectOption(language);
    await page
      .getByRole("button", { name: "Save language", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: t("settings.title"), exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: t("settings.saved") }),
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
    // Customer and partner routes render in the reader's language.
    await page.setExtraHTTPHeaders({ "x-clockwork-persona": "owner" });
    await gotoHydrated(page, "/dashboard");
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      language === "ar" ? "rtl" : "ltr",
    );
    await expect(
      page.getByRole("link", { name: t("nav.dashboard"), exact: true }).first(),
    ).toBeVisible();
    // Staff routes render in English whatever language was saved.
    await page.setExtraHTTPHeaders({});
    await page.goto("/internal/operations");
    await expect(
      page.getByRole("heading", {
        name: english("operations.home.title"),
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(
      page
        .getByRole("link", {
          name: english("nav.internal.search"),
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoHydrated(page, "/settings");
    await expect(
      page.getByRole("heading", { name: t("settings.title"), exact: true }),
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
      .getByRole("button", { name: t("settings.save"), exact: true })
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
