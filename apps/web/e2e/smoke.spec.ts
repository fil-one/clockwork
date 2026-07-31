import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("@smoke renders the customer experience and its API lane mounts", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Good afternoon",
  );
  await expect(page.getByText("Demo environment").first()).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  for (const lane of ["core", "lifecycle", "system"]) {
    const response = await request.get(`/api/v1/${lane}/status`);
    expect(response.ok()).toBeTruthy();
    expect(await response.json()).toEqual({ lane, status: "ready" });
  }
});
