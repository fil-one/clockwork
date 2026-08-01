import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function usePersona(page: Page, role: string) {
  await page.setExtraHTTPHeaders({ "x-clockwork-persona": role });
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}

async function expectAxeClean(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations).toEqual([]);
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
    await expect(
      page.getByRole("status", { name: "Assisted mode state" }),
    ).toContainText("Effective account: Northstar Archive Labs");
    await expect(
      page.getByRole("status", { name: "Assisted mode state" }),
    ).toContainText("Staff actor: Morgan Ellis");
    await page
      .getByRole("textbox", { name: /Assisted-mode reason/ })
      .fill("Customer requested help reviewing a commercial adjustment.");
    await page.getByRole("button", { name: "Review assisted action" }).click();
    await expect(
      page.getByRole("heading", { name: "Assisted action review" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submit assisted action" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("link", { name: "Exit assisted mode" }),
    ).toBeVisible();
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
    await page.getByRole("button", { name: "Record approval" }).click();
    await expect(page.getByRole("status")).toContainText("Server authority");
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
    await page.getByRole("button", { name: "Record approval" }).click();
    await expect(page.getByRole("status")).toContainText("actor separation");
    await expectNoHorizontalOverflow(page);
  });
});
