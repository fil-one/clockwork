import { expect, test } from "@playwright/test";

const desktopSurfaces = [
  { name: "customer-dashboard", path: "/dashboard" },
  { name: "partner-agreement-clock", path: "/partner" },
  { name: "internal-queues", path: "/internal/queues" },
] as const;

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
