import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { resetDemoExperience } from "@clockwork/testing/demo-reset";
import { FileDemoAdapterStateStore } from "@clockwork/testing/demo-state";

/**
 * Queue actions write to the durable demo adapter state, so the record would
 * carry no permitted action on a second run. Restoring the pristine state keeps
 * the assertion about the record itself rather than about run order.
 */
async function resetDurableDemoState() {
  if (process.env.CLOCKWORK_EXPERIENCE_ADAPTER !== "demo")
    throw new Error(
      "Internal queue mutations require the explicit non-production demo adapter.",
    );
  await resetDemoExperience(new FileDemoAdapterStateStore(), {
    environment: process.env,
    target: "demo",
  });
}

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

  test("loads the queue projection without inventing unrecorded facts", async ({
    page,
  }) => {
    await page.goto("/internal/queues");
    await expect(
      page.getByRole("heading", { level: 1, name: "Operational queues" }),
    ).toBeVisible();
    const table = page.getByRole("table", {
      name: /Operational queue results sorted by SLA, risk, then age/,
    });
    await expect(table).toBeVisible();
    // Header row plus one row per authorized projection record. The workspace
    // reads the session-scoped queue projection, so a fixture never adds rows.
    await expect(table.getByRole("row")).toHaveCount(4);
    await expect(page.getByText("3 results")).toBeVisible();
    await expect(table.getByText("EXC-COL-008").first()).toBeVisible();
    // The projection carries no risk, age, or backup for these records, and the
    // surface says so instead of filling in a plausible value.
    await expect(table.getByText("Not supplied").first()).toBeVisible();
    await expect(table.getByText("Backup needed").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("submits a version-bound queue action from the record detail", async ({
    page,
  }) => {
    await resetDurableDemoState();
    await page.goto("/internal/queues/EXC-COL-008");
    await expect(
      page.getByRole("heading", { level: 1, name: "Queue record" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "review exception" }).click();
    // The receipt poll replaces the queued line with the authoritative result,
    // so either terminal wording proves the version-bound submission landed.
    // The window covers the action route's first compile on a cold dev server
    // followed by the fifteen one-second receipt polls.
    await expect(
      page.getByText(/review exception (is queued|applied)/),
    ).toBeVisible({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByText("EXC-COL-008").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await resetDurableDemoState();
  });

  test("search route returns only scoped operational projections", async ({
    page,
  }) => {
    await page.goto("/internal/search");
    await expect(
      page.getByRole("heading", { level: 1, name: "Global search" }),
    ).toBeVisible();
    const search = page.getByRole("searchbox", {
      name: "Search accounts, records, and documents",
    });
    await search.fill("collections");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const results = page.getByRole("region", { name: "Search results" });
    await expect(
      results.getByRole("link", { name: "Collections aging decision" }),
    ).toBeVisible();
    await results.getByText("Reference", { exact: true }).click();
    await expect(results.getByText("EXC-COL-008")).toBeVisible();

    // Scope is the session projection, not a global index: a record that exists
    // only for another audience is not reachable from the operator search.
    await search.fill("Halcyon archive expansion");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: /No results for/ }),
    ).toBeVisible();
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

  test("reviews the finance case it holds authority over without recording a decision", async ({
    page,
  }) => {
    await page.goto("/internal/approvals");
    await expect(
      page.getByRole("heading", { level: 1, name: "Approval review" }),
    ).toBeVisible();
    await expect(page.getByText("Authorized role")).toBeVisible();
    const submit = page.getByRole("button", { name: "Review approval" });
    await expect(submit).toBeEnabled();
    await page
      .getByRole("textbox", { name: "Decision reason" })
      .fill("Exception evidence matches the pricing floor policy.");
    await submit.click();
    await expect(
      page.getByRole("heading", { name: "Approval review summary" }),
    ).toBeVisible();
    // Review is not a decision: the surface says so rather than implying the
    // approval was recorded.
    await expect(
      page.getByText("Secure decision submission required"),
    ).toBeVisible();
  });

  test("labels renewal and report values by their truth state", async ({
    page,
  }) => {
    // NOTE: these two surfaces render module-level fixtures rather than the
    // session projection, so this asserts the value-state labeling they do
    // guarantee. The projection-backed "no invented rows" guarantee is covered
    // by the queue and search tests above. See the reported defect.
    await page.goto("/internal/renewals");
    await expect(
      page.getByRole("heading", { level: 1, name: "Renewal exposure" }),
    ).toBeVisible();
    await expect(page.getByText("Exposure is planning data.")).toBeVisible();
    await expect(
      page.getByText(/not an invoice, payment, or collected-revenue total/),
    ).toBeVisible();

    await page.goto("/internal/reports");
    await expect(
      page.getByRole("heading", { level: 1, name: "Operational reports" }),
    ).toBeVisible();
    await expect(
      page.getByText("Pending reconciliation").first(),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("legal approver journey", () => {
  test.beforeEach(async ({ page }) => usePersona(page, "legal_approver"));

  test("holds legal authority on the agreement template scan", async ({
    page,
  }) => {
    await page.goto("/internal/agreements");
    await expect(
      page.getByRole("heading", { level: 1, name: "Agreement templates" }),
    ).toBeVisible();
    await expect(page.getByText("Legal authority")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review template approval" }),
    ).toBeEnabled();
    await expectAxeClean(page);
  });

  test("cannot approve finance price-book activation", async ({ page }) => {
    await page.goto("/internal/price-books");
    await expect(
      page.getByRole("heading", { level: 1, name: "Price books" }),
    ).toBeVisible();
    await expect(page.getByText("Read only")).toBeVisible();
    await expect(
      page.getByText("Finance approval authority is required."),
    ).toBeVisible();
    // The only control that could activate a rate card stays closed to legal.
    await expect(
      page.getByRole("button", { name: "Review price-book approval" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: /approve/i, disabled: false }),
    ).toHaveCount(0);
  });
});

test.describe("destructive-action approver journey", () => {
  test.beforeEach(async ({ page }) =>
    usePersona(page, "destructive_action_approver"),
  );

  test("cannot decide the finance-only approval case", async ({ page }) => {
    await page.goto("/internal/approvals");
    await expect(
      page.getByRole("heading", { level: 1, name: "Approval review" }),
    ).toBeVisible();
    await expect(page.getByText("Read only")).toBeVisible();
    await expect(
      page.getByText("This role cannot decide this case."),
    ).toBeVisible();
    // The decision form is the only control that could record an approval, and
    // it stays closed to a role without finance authority.
    await expect(
      page.getByRole("button", { name: "Review approval" }),
    ).toBeDisabled();
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
    await page.goto("/internal/queues");
    const search = page.getByRole("button", { name: "Search and commands" });
    await expectTouchTarget(search);
    await expectVisibleFocus(search);
    // Below the split-panel breakpoint the row opens the full-page detail, so
    // the primary target in the table is the record link rather than the
    // desktop row-select button.
    const record = page
      .getByRole("link", { name: /Collections aging decision/ })
      .first();
    await expectTouchTarget(record);
    await expectVisibleFocus(record);
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
