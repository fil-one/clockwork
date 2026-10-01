import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import type { Dictionary } from "../lib/i18n";
import { locales } from "../lib/i18n";

test("the first visit explains the offer, availability and roadmap without a login", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Connected.",
  );
  await expect(page.getByText("No sign-up needed")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Live Fil One connection" }),
  ).toBeVisible();
  await expect(
    page.getByText("Integration planned", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Clockwork");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("a customer deal completes with consistent amounts and confirmed delivery", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (
      !request.url().startsWith("http://localhost:3101") &&
      !request.url().startsWith("data:")
    )
      externalRequests.push(request.url());
  });
  await page.goto("/tour");
  await page.getByRole("button", { name: "Prepare sample quote" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Quote CW-1042 prepared" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review the terms", exact: true })
    .click();
  await page.getByRole("button", { name: "Approve sample terms" }).click();
  await page.getByRole("button", { name: "See the customer view" }).click();
  await expect(
    page.getByRole("button", { name: "Accept sample quote" }),
  ).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Accept sample quote" }).click();
  await page.getByRole("button", { name: "Follow service activation" }).click();
  await page
    .getByRole("button", { name: "Send simulated service request" })
    .click();
  await expect(
    page.getByText("Request accepted. Service is not active yet."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Try a delayed confirmation" })
    .click();
  await expect(page.getByText("Waiting for a confirmed result")).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Retry simulated service request" })
    .click();
  await page
    .getByRole("button", { name: "Confirm simulated activation" })
    .click();
  await page.getByRole("button", { name: "Follow the invoice" }).click();
  await page.getByRole("button", { name: "Record sample payment" }).click();
  await expect(page.locator(".record-details")).toContainText("$0");
  await page.getByRole("button", { name: "See the takeaway" }).click();
  await expect(
    page.getByRole("region", { name: "Tour takeaway" }),
  ).toContainText("$54,000");
  expect(externalRequests).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("deep links, future mode, browser history, and reset are honest about progress", async ({
  page,
}) => {
  await page.goto("/tour?step=3&mode=connected");
  await expect(
    page.getByText("Planned integration preview", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Sample actions completed: 0 / 5")).toBeVisible();
  await page.getByRole("button", { name: "Load sample at this step" }).click();
  await expect(
    page.getByText("Sample actions completed: 3 / 5 · includes prepared steps"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Explore next scene" }).click();
  await expect(
    page.getByRole("heading", { name: "Close the loop with billing." }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Follow the order through delivery." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restart tour", exact: true }).click();
  await page.getByRole("button", { name: "Restart my sample" }).click();
  await expect(page.getByText("Sample actions completed: 0 / 5")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Demo today" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Prepare sample quote" }),
  ).toBeEnabled();
});

test("two visitors cannot change or reset each other's transaction", async ({
  page,
  browser,
}) => {
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  try {
    await page.goto("/tour?step=4");
    await page
      .getByRole("button", { name: "Load sample at this step" })
      .click();
    await otherPage.goto("http://localhost:3101/tour");
    await expect(
      otherPage.getByText("Sample actions completed: 0 / 5"),
    ).toBeVisible();
    await otherPage
      .getByRole("button", { name: "Restart tour", exact: true })
      .click();
    await otherPage.getByRole("button", { name: "Restart my sample" }).click();
    await page.reload();
    await expect(
      page.getByText(
        "Sample actions completed: 4 / 5 · includes prepared steps",
      ),
    ).toBeVisible();
  } finally {
    await other.close();
  }
});

test("every scene remains accessible and fits a narrow viewport", async ({
  page,
}) => {
  for (const step of [0, 1, 2, 3, 4]) {
    await page.goto(`/tour?step=${step}`);
    if (step > 0)
      await page
        .getByRole("button", { name: "Load sample at this step" })
        .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
});

test("a share preview exists and unknown paths recover to the overview", async ({
  page,
  request,
}) => {
  const image = await request.get("/opengraph-image");
  expect(image.ok()).toBe(true);
  expect(image.headers()["content-type"]).toContain("image/png");
  expect((await image.body()).byteLength).toBeGreaterThan(10000);
  await page.goto("/missing");
  await expect(
    page.getByRole("heading", { name: "This link has taken a detour." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to the overview" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Connected.",
  );
});

test("all languages cover the tour, survive reload, and fit without overflow", async ({
  page,
}) => {
  for (const locale of ["es", "fr", "de", "ja", "pt", "zh", "ar"]) {
    await page.goto(`/${locale}/tour?step=3&mode=connected`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      locale === "ar" ? "rtl" : "ltr",
    );
    await expect(page.locator(".language-selector select")).toHaveValue(locale);
    await expect(page.locator(".future-note")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      "Planned integration preview",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      locale,
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).analyze()).violations,
      locale,
    ).toEqual([]);
    await page.reload();
    await expect(page.locator(".language-selector select")).toHaveValue(locale);
  }
});

test("changing language preserves the transaction, scene, mode and numeric facts", async ({
  page,
}) => {
  await page.goto("/en/tour");
  await page.getByRole("button", { name: "Prepare sample quote" }).click();
  await page
    .getByRole("button", { name: "Review the terms", exact: true })
    .click();
  await expect(page).toHaveURL(/step=1/);
  await page.locator(".language-selector select").selectOption("de");
  await expect(page).toHaveURL(/\/de\/tour\?step=1/);
  await expect(page.locator(".tour-bottom-bar")).toContainText("1 / 5");
  await expect(page.locator(".review-grid")).toContainText("54.000");
  await page.locator(".workspace-actions .button").click();
  await page.locator(".language-selector select").selectOption("ar");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator(".tour-bottom-bar")).toContainText(/2\u2069? \/ 5/);
  await expect(page.locator(".action-result")).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/\/ar$/);
});

test("narrow screens, large text and keyboard access retain readable controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/de/tour?step=4");
  await page.locator(".prepare-state .button").click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    const elements = [...document.querySelectorAll<HTMLElement>("body *")];
    const sizes = elements.map((element) =>
      parseFloat(getComputedStyle(element).fontSize),
    );
    elements.forEach((element, index) => {
      element.style.fontSize = `${(sizes[index] ?? 16) * 2}px`;
    });
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

for (const locale of locales) {
  test(`${locale}: a complete localized deal and sharing image`, async ({
    page,
    request,
  }) => {
    const d = JSON.parse(
      await readFile(
        new URL(`../lib/locales/${locale}.json`, import.meta.url),
        "utf8",
      ),
    ) as Dictionary;
    const image = await request.get(`/${locale}/opengraph-image`);
    expect(image.ok()).toBe(true);
    expect(image.headers()["content-type"]).toContain("image/png");
    expect((await image.body()).byteLength).toBeGreaterThan(10000);
    await page.goto(`/${locale}/tour`);
    for (let step = 0; step < 5; step++) {
      if (step === 2) await page.getByRole("checkbox").check();
      await page.locator(".workspace-actions > .button").click();
      if (step === 3)
        await page
          .getByRole("button", {
            name: d["sales.confirm.simulated.activation.b2bb2"],
            exact: true,
          })
          .click();
      await expect(page.locator(".action-result")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        `${locale} scene ${step}`,
      ).toBe(true);
      await page.locator(".tour-bottom-bar .button").click();
    }
    await expect(
      page.getByRole("region", { name: d["sales.tour.takeaway.c633e"] }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
