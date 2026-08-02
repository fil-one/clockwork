import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("@smoke renders the customer experience and its API lane mounts", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Welcome back",
  );
  await expect(page.getByText("Demo environment").first()).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  for (const lane of ["core", "lifecycle", "system"] as const) {
    const response = await request.get(`/api/v1/${lane}/status`);
    expect(response.ok()).toBeTruthy();
    const status = (await response.json()) as {
      lane: string;
      status: "degraded" | "ready" | "unavailable";
      details?: Record<string, string>;
    };
    expect(status.lane).toBe(lane);
    expect(["degraded", "ready", "unavailable"]).toContain(status.status);
    if (status.status !== "ready")
      expect(status.details).toEqual(expect.any(Object));
  }
});
