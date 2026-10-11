import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { expectShellHydrated, gotoHydrated } from "./shell-hydration";

const password = process.env.CLOCKWORK_DEMO_ACCESS_PASSWORD ?? "";
if (!password)
  throw new Error(
    "The demo pricing journeys require CLOCKWORK_DEMO_ACCESS_PASSWORD, as the demo shard sets.",
  );

/** Through the demo gate and into the revenue persona's home. */
async function startAsSeller(page: Page) {
  await page.goto("/demo");
  await expect(page).toHaveURL(/\/demo\/access/u);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/demo$/u);
  await page.getByRole("link", { name: "Start as Priya Raman" }).click();
  await expectShellHydrated(page);
}

/**
 * The seller's pricing builder against the demo price books: capacity in
 * binary units, partner economics, and the fictional examples with their
 * customer and partner summaries. Figures that depend on the demo list price
 * are read from the page rather than pinned, so a repriced fixture keeps
 * these journeys green.
 */
test.describe("pricing builder", () => {
  test.beforeEach(async ({ page }) => startAsSeller(page));

  test("converts PiB to TB and works out a resale margin", async ({ page }) => {
    await gotoHydrated(page, "/internal/pricing");
    const line = page.getByRole("group", { name: "Line 1" });
    await line.getByLabel("Unit").selectOption("PiB");
    const capacity = line.getByLabel("Capacity (PiB)");
    await capacity.fill("10");
    await expect(line.getByText("10 PiB ≈ 11,259 TB")).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Year 1");

    const panel = page.getByRole("group", { name: "Partner economics" });
    await panel.getByLabel("Partner model").selectOption("resale");
    await panel
      .getByLabel("Partner's price to its customer, per TB-month")
      .fill("6.50");
    await panel.getByLabel("Partner margin (%)").fill("32");
    await expect(
      panel.getByText("Fil One's price to the partner: $4.42 per TB-month."),
    ).toBeVisible();
    const figures = panel.getByRole("table", { name: "Partner figures" });
    await expect(
      figures.getByRole("row", { name: /Partner earns/u }),
    ).toContainText("$2.08");
    await expect(
      figures.getByRole("row", { name: /Fil One net revenue/u }),
    ).toContainText("$4.42");
  });

  test("opens the demo examples and downloads both summaries", async ({
    page,
  }) => {
    await gotoHydrated(page, "/internal/pricing");
    const examples = page.getByRole("region", { name: "Example scenarios" });
    await examples
      .getByRole("link", { name: "Open Regional referral, 10 PiB" })
      .click();
    await expect(page).toHaveURL(/scenario=/u);
    const line = page.getByRole("group", { name: "Line 1" });
    await expect(line.getByLabel("Capacity (PiB)")).toHaveValue("10");
    const panel = page.getByRole("group", { name: "Partner economics" });
    await expect(panel.getByLabel("Partner model")).toHaveValue("referral");
    const periods = panel.getByRole("table", { name: "By period" });
    await expect(periods.getByRole("row")).toHaveCount(4);
    await expect(periods).toContainText("30%");
    await expect(periods).toContainText("10%");
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(axe.violations).toEqual([]);

    for (const [name, filename] of [
      [
        "Download the indicative summary for Regional referral, 10 PiB",
        /Meridian Data Vaults .*\.pdf$/u,
      ],
      [
        "Download the partner summary for Regional referral, 10 PiB",
        /partner\.pdf$/u,
      ],
    ] as const) {
      const href = await examples
        .getByRole("link", { name })
        .getAttribute("href");
      const response = await page.request.get(href ?? "");
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("application/pdf");
      expect(response.headers()["content-disposition"]).toMatch(filename);
    }
  });
});
