import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const INTERNAL_VIEWPORTS = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 800 },
] as const;

const INTERNAL_DESTINATIONS = [
  "Operations",
  "Global search",
  "Queues & approvals",
  "Renewal command",
  "Provisioning",
  "Migrations",
  "Reports",
  "External gates",
  "Assisted mode",
] as const;

async function usePersona(page: Page, role: string) {
  await page.setExtraHTTPHeaders({ "x-clockwork-persona": role });
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

async function expectAxeClean(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}

async function expectTouchTarget(locator: Locator, minimum = 42) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width).toBeGreaterThanOrEqual(minimum);
  expect(box?.height).toBeGreaterThanOrEqual(minimum);
}

async function expectVisibleFocus(locator: Locator) {
  await locator.focus();
  await expect(locator).toBeFocused();
  expect(
    await locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return style.outlineStyle !== "none" && style.outlineWidth !== "0px";
    }),
  ).toBe(true);
}

test.describe("internal operator operations journey", () => {
  test.beforeEach(async ({ page }) => usePersona(page, "internal_operator"));

  test("filters queues, selects split detail, and keeps state in the URL", async ({
    page,
  }) => {
    await page.goto("/internal/queues");
    await expect(
      page.getByRole("heading", { level: 1, name: "Operational queues" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "SLA breached" }).click();
    await expect(page).toHaveURL(/view=sla-breached/);
    await page
      .getByRole("combobox", { name: "Risk", exact: true })
      .selectOption("high");
    await expect(page).toHaveURL(/risk=high/);
    await expect(page.getByLabel("Active filters")).toContainText("Risk: high");
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Risk", exact: true }),
    ).toHaveValue("high");
    await expect(page.getByLabel("Active filters")).toContainText("Risk: high");
    await page.goto("/internal/reports");
    await page.goBack();
    await expect(page).toHaveURL(/view=sla-breached/);
    await expect(page).toHaveURL(/risk=high/);
    await page
      .getByRole("button", { name: /Show details for/ })
      .first()
      .click();
    await expect(
      page
        .getByLabel("Selected queue item details")
        .getByRole("heading", { level: 2 }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("searches grouped operational records with a title as the navigation target", async ({
    page,
  }) => {
    await page.goto("/internal/search");
    const search = page.getByRole("searchbox", {
      name: "Search accounts, records, and documents",
    });
    await search.fill("Northstar");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/q=Northstar/);
    await expect(
      page.getByRole("heading", { level: 2, name: /Accounts/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Northstar Archive Labs" }),
    ).toBeVisible();
    await search.press("ArrowDown");
    await expect(
      page.getByRole("link", { name: "Northstar Archive Labs" }),
    ).toBeFocused();
  });

  test("shows grouped fail-closed gates and assisted review before submission", async ({
    page,
  }) => {
    await page.goto("/internal/gates");
    for (const group of ["Provider", "Legal", "Brand", "Operations"]) {
      await expect(
        page.getByRole("heading", { level: 2, name: group }),
      ).toBeVisible();
    }
    await expect(page.getByText(/Activation is fail-closed/)).toBeVisible();
    await expectAxeClean(page);

    await page.goto("/internal/assisted");
    const assistedState = page.getByLabel("Assisted mode active");
    await expect(assistedState).toContainText("Effective account");
    await expect(assistedState).toContainText("Northstar Archive Labs");
    await expect(assistedState).toContainText("Staff actor");
    await expect(assistedState).toContainText("Morgan Ellis");
    await expect(page.locator(".assisted-banner:visible")).toHaveCount(0);
    await page
      .getByRole("textbox", { name: /Assisted-mode reason/ })
      .fill("Customer requested help reviewing a commercial adjustment.");
    await page.getByRole("button", { name: "Review assisted action" }).click();
    await expect(
      page.getByRole("heading", { name: "Assisted action review" }),
    ).toBeVisible();
    await expect(
      page.getByText("Assisted action not submitted", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Review exit" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("keeps every internal destination operable in the 320px drawer", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/internal");
    const trigger = page.getByRole("button", { name: "Open navigation" });
    await expectTouchTarget(trigger);
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    for (const destination of INTERNAL_DESTINATIONS) {
      await expectTouchTarget(
        drawer.getByRole("link", { name: destination, exact: true }),
      );
    }
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await drawer
      .getByRole("link", { name: "Global search", exact: true })
      .click();
    await expect(page).toHaveURL(/\/internal\/search$/);
    await expect(drawer).toBeHidden();
    await expectNoHorizontalOverflow(page);
  });

  test("uses a full-page queue detail on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/internal/queues?view=all");
    await page
      .getByRole("link", { name: /Collections aging decision/ })
      .click();
    await expect(page).toHaveURL(/\/internal\/queues\/EXC-COL-008/);
    await expect(
      page.getByRole("heading", { name: "Collections aging decision" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Evidence" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("finance approver journey", () => {
  test.beforeEach(async ({ page }) => usePersona(page, "finance_approver"));

  test("reviews a finance approval with a required reason", async ({
    page,
  }) => {
    await page.goto("/internal/approvals");
    await page
      .getByRole("textbox", { name: /Decision reason/ })
      .fill("Margin evidence and credit state support this exception.");
    await page.getByRole("button", { name: "Review approval" }).click();
    await expect(
      page.getByRole("heading", { name: "Approval review summary" }),
    ).toBeVisible();
    await expect(page.getByText("Required reason")).toBeVisible();
    await expect(
      page.getByText("Secure decision submission required", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Record approval" }),
    ).toHaveCount(0);
  });

  test("distinguishes renewal exposure and report truth", async ({ page }) => {
    await page.goto("/internal/renewals");
    await expect(
      page.getByRole("heading", { level: 1, name: "Renewal exposure" }),
    ).toBeVisible();
    await expect(page.getByText("Exposure is planning data.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Next 30 days" }),
    ).toBeVisible();

    await page.goto("/internal/reports");
    await expect(
      page.getByRole("heading", { level: 1, name: "Operational reports" }),
    ).toBeVisible();
    await page.getByLabel("Report", { exact: true }).selectOption({ index: 1 });
    await expect(
      page.getByRole("heading", { name: "Available report results" }),
    ).toBeVisible();
    await expect(page.getByText("Semantic chart data")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("legal approver journey", () => {
  test.beforeEach(async ({ page }) => usePersona(page, "legal_approver"));

  test("scans agreement versions and reviews exact-template publication", async ({
    page,
  }) => {
    await page.goto("/internal/agreements");
    await expect(
      page.getByRole("heading", { level: 1, name: "Agreement templates" }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "State", exact: true })
      .selectOption("Draft");
    await expect(page.getByText(/1 of 4 versions/)).toBeVisible();
    await page
      .getByRole("textbox", { name: /Counsel decision reason/ })
      .fill("Counsel verified the canonical text and effective-date evidence.");
    await page
      .getByRole("button", { name: "Review template approval" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Agreement publication review" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /Existing signed agreements and domain rules are unchanged/,
      ),
    ).toBeVisible();
    await expectAxeClean(page);
  });

  test("cannot approve finance price-book activation", async ({ page }) => {
    await page.goto("/internal/price-books");
    await expect(
      page.getByRole("button", { name: "Review price-book approval" }),
    ).toBeDisabled();
    await expect(
      page.getByText("Finance approval authority is required."),
    ).toBeVisible();
  });
});

test.describe("destructive-action approver journey", () => {
  test.beforeEach(async ({ page }) =>
    usePersona(page, "destructive_action_approver"),
  );

  test("reviews offboarding impact while preserving dual control and retention", async ({
    page,
  }) => {
    await page.goto("/internal/approvals");
    await page
      .getByRole("button", { name: /Legacy analytics archive offboarding/ })
      .click();
    await expect(
      page.getByText("Second distinct approver required"),
    ).toBeVisible();
    await expect(
      page.getByText("Retention exclusions preserved"),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: /Decision reason/ })
      .fill("Retention evidence supports one segregated approval only.");
    await page.getByRole("button", { name: "Review approval" }).click();
    await expect(
      page.getByRole("heading", { name: "Approval review summary" }),
    ).toBeVisible();
    await expect(
      page.getByText("Secure decision submission required", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/actor separation/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("internal responsive and accessibility coverage", () => {
  test.beforeEach(async ({ page }) => usePersona(page, "internal_operator"));

  test("keeps representative surfaces responsive across release viewports", async ({
    page,
  }) => {
    const surfaces = [
      { path: "/internal", heading: "Operational health" },
      {
        path: "/internal/queues?view=sla-breached",
        heading: "Operational queues",
      },
      { path: "/internal/reports", heading: "Operational reports" },
    ] as const;

    for (const viewport of INTERNAL_VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const surface of surfaces) {
        await page.goto(surface.path);
        await expect(
          page.getByRole("heading", { level: 1, name: surface.heading }),
        ).toBeVisible();
        await expectNoHorizontalOverflow(page);
      }
    }
  });

  test("keeps internal primary targets reachable with visible focus at 320px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/internal");
    const queueLink = page.getByRole("link", { name: "Open my queue" });
    await expectTouchTarget(queueLink);
    await expectVisibleFocus(queueLink);

    await page.goto("/internal/queues?view=all");
    await expectTouchTarget(
      page.getByRole("combobox", { name: "Risk", exact: true }),
    );
    await expectVisibleFocus(
      page.getByRole("combobox", { name: "Risk", exact: true }),
    );

    await page.goto("/internal/reports");
    const exportButton = page
      .getByRole("button", { name: "Export CSV" })
      .first();
    await expectTouchTarget(exportButton);
    await expectVisibleFocus(exportButton);
  });

  test("passes axe on representative operations, queue, and report surfaces", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ["/internal", "/internal/queues", "/internal/reports"]) {
      await page.goto(path);
      await expectAxeClean(page);
    }
  });

  test("removes internal loading motion when reduced motion is requested", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/internal/queues");
    const risk = page.getByRole("combobox", { name: "Risk", exact: true });
    await risk.selectOption("high");
    const loader = page
      .locator('[role="status"]')
      .filter({ hasText: "Updating" });
    if (await loader.isVisible()) {
      await expect(loader.locator("span")).toHaveCSS("animation-name", "none");
    }
    await expect(page).toHaveURL(/risk=high/);
  });
});
