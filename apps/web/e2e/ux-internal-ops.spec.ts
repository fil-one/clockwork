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

  test("loads the queue projection and submits a version-bound action", async ({
    page,
  }) => {
    await page.goto("/internal/queues");
    await expect(
      page.getByRole("heading", { level: 1, name: "Operational queues" }),
    ).toBeVisible();
    const table = page.getByRole("table", {
      name: /Operational queues.*session-scoped records/,
    });
    await expect(table).toBeVisible();
    await expect(table.getByRole("row")).toHaveCount(4);
    await table
      .getByRole("button", { name: "review exception" })
      .first()
      .click();
    await expect(table.getByText("review exception queued")).toBeVisible({
      timeout: 15_000,
    });
    await page.reload();
    await expect(table).toBeVisible();
    await expect(page.getByText("EXC-COL-008")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("search route returns only scoped operational projections", async ({
    page,
  }) => {
    await page.goto("/internal/search");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Scoped operational search",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 3,
        name: "Collections aging decision",
      }),
    ).toBeVisible();
    await expect(page.getByText("EXC-COL-008")).toBeVisible();
    await expectNoHorizontalOverflow(page);
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
    await expect(page.getByLabel("Assisted mode active")).toHaveCount(0);
    await expect(
      page.getByText("The staff actor never changes."),
    ).toBeVisible();
    await expect(
      page.getByText(/Demo internal operator · operator@clockwork.test/),
    ).toBeVisible();
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
    await expect(
      page.getByRole("button", { name: "Start 15-minute assisted session" }),
    ).toBeVisible();
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
    await page.goto("/internal/queues/EXC-COL-008");
    await expect(page).toHaveURL(/\/internal\/queues\/EXC-COL-008/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Queue record" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 3,
        name: "Collections aging decision",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Attach evidence" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("finance approver journey", () => {
  test.beforeEach(async ({ page }) => usePersona(page, "finance_approver"));

  test("queues only the persisted finance approval action", async ({
    page,
  }) => {
    await page.goto("/internal/approvals");
    await expect(
      page.getByRole("heading", { level: 1, name: "Approval decisions" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "approve exception" }).click();
    await expect(page.getByText("approve exception queued")).toBeVisible();
  });

  test("renders honest empty renewal and report projections", async ({
    page,
  }) => {
    await page.goto("/internal/renewals");
    await expect(
      page.getByRole("heading", { level: 1, name: "Renewals" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "No work in this queue" }),
    ).toBeVisible();

    await page.goto("/internal/reports");
    await expect(
      page.getByRole("heading", { level: 1, name: "Reports" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "No work in this queue" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("legal approver journey", () => {
  test.beforeEach(async ({ page }) => usePersona(page, "legal_approver"));

  test("shows the authorized agreement projection without invented versions", async ({
    page,
  }) => {
    await page.goto("/internal/agreements");
    await expect(
      page.getByRole("heading", { level: 1, name: "Agreement administration" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "No work in this queue" }),
    ).toBeVisible();
    await expectAxeClean(page);
  });

  test("cannot approve finance price-book activation", async ({ page }) => {
    await page.goto("/internal/price-books");
    await expect(
      page.getByRole("heading", { level: 1, name: "Price-book evidence" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "No records available" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /approve/i })).toHaveCount(0);
  });
});

test.describe("destructive-action approver journey", () => {
  test.beforeEach(async ({ page }) =>
    usePersona(page, "destructive_action_approver"),
  );

  test("cannot use the finance-only projection action", async ({ page }) => {
    await page.goto("/internal/approvals");
    await expect(
      page.getByRole("heading", { level: 1, name: "Approval decisions" }),
    ).toBeVisible();
    await expect(page.getByText("Read only")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "approve exception" }),
    ).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("internal responsive and accessibility coverage", () => {
  test.beforeEach(async ({ page }) => usePersona(page, "internal_operator"));

  test("keeps representative surfaces responsive across release viewports", async ({
    page,
  }) => {
    const surfaces = [
      { path: "/internal", heading: "Operator home" },
      {
        path: "/internal/queues?view=sla-breached",
        heading: "Operational queues",
      },
      { path: "/internal/reports", heading: "Reports" },
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
    await page.goto("/internal/queues");
    const search = page.getByRole("button", { name: "Search and commands" });
    await expectTouchTarget(search);
    await expectVisibleFocus(search);
    const action = page
      .getByRole("button", { name: "review exception" })
      .first();
    await expectTouchTarget(action);
    await expectVisibleFocus(action);
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
    const animated = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((element) => element.getClientRects().length > 0)
        .filter((element) => getComputedStyle(element).animationName !== "none")
        .map((element) => element.tagName),
    );
    expect(animated).toEqual([]);
  });
});
