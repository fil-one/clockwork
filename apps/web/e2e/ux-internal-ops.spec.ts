import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { resetDemoExperience } from "@clockwork/testing/demo-reset";
import { FileDemoAdapterStateStore } from "@clockwork/testing/demo-state";

import { gotoHydrated } from "./shell-hydration";
import { expectTargetSize } from "./target-size";

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
  "Recovery",
  "Migrations",
  "Reports",
  "Revenue & channel",
  "Billing reconciliation",
  "Integration status",
  "Unhandled errors",
  "External gates",
  "Capabilities",
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
    await expect(table.getByRole("row")).toHaveCount(7);
    await expect(page.getByText("6 results")).toBeVisible();
    await expect(table.getByText("EXC-COL-008").first()).toBeVisible();
    // The projection carries no risk, age, or backup for these records, and the
    // surface says so instead of filling in a plausible value.
    await expect(table.getByText("Not recorded").first()).toBeVisible();
    await expect(table.getByText("No backup").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("submits a version-bound queue action from the record detail", async ({
    page,
  }) => {
    await resetDurableDemoState();
    await gotoHydrated(page, "/internal/queues/EXC-COL-008");
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

  test("native search submission preserves the query without a React submit handler", async ({
    page,
  }) => {
    await resetDurableDemoState();
    // The one load here that deliberately does not wait for the shell to
    // hydrate. Nothing below touches a React handler: the field is uncontrolled
    // and the submit is the browser's own, which is the whole point.
    await page.goto("/internal/search");
    await page
      .getByRole("searchbox", {
        name: "Search accounts, records, and documents",
      })
      .fill("collections");
    // Native submit deliberately bypasses React's handler, as an early submit
    // can before hydration. The streamed Next layout itself requires JavaScript.
    await page
      .getByRole("search")
      .evaluate((form) => (form as HTMLFormElement).submit());
    await expect(page).toHaveURL(/q=collections/);
    await expect(
      page
        .getByRole("region", { name: "Search results" })
        .getByRole("link", { name: "Collections aging decision" }),
    ).toBeVisible();
  });

  test("search route returns only scoped operational projections", async ({
    page,
  }) => {
    // The preceding queue journey deliberately changes this same durable
    // projection. Reset at the fixture-dependent test boundary so a failed or
    // interrupted sibling cannot make search results depend on execution order.
    await resetDurableDemoState();
    await gotoHydrated(page, "/internal/search");
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

    await gotoHydrated(page, "/internal/assisted");
    await expect(page.getByLabel("Assisted mode active")).toHaveCount(0);
    await expect(
      page.getByText("The staff actor never changes."),
    ).toBeVisible();
    await expect(
      page.getByText(/Demo internal operator · operator@filone.test/),
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
    await gotoHydrated(page, "/internal");
    const trigger = page.getByRole("button", { name: "Open navigation" });
    await expectTargetSize(trigger);
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    for (const destination of INTERNAL_DESTINATIONS) {
      await expectTargetSize(
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

  test("reads all three generated status endpoints through the application origin", async ({
    page,
  }) => {
    await page.goto("/internal/status");
    for (const lane of ["Commerce", "Customer lifecycle", "Operations"]) {
      await expect(
        page.getByRole("heading", { level: 3, name: lane }),
      ).toBeVisible();
    }
    await expect(page.getByText(/^Updated /)).toHaveCount(3);
    await expect(
      page.getByText("This status endpoint did not return a readable result."),
    ).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expectAxeClean(page);
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

  test("records a finance decision and preserves it across reload", async ({
    page,
  }) => {
    await resetDurableDemoState();
    try {
      await gotoHydrated(page, "/internal/approvals");
      await expect(
        page.getByRole("heading", { level: 1, name: "Approval decisions" }),
      ).toBeVisible();
      await expect(page.getByText("APR-DEMO-001").first()).toBeVisible();
      await expect(
        page.getByText("Awaiting approval", { exact: true }).first(),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Approve exception", exact: true })
        .click();
      await expect(
        page.getByText("Approved", { exact: true }).first(),
      ).toBeVisible({
        timeout: 60_000,
      });
      await page.reload();
      await expect(
        page.getByText("Approved", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Approve exception", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Reject exception", exact: true }),
      ).toHaveCount(0);
    } finally {
      await resetDurableDemoState();
    }
  });

  test("presents renewal and reporting work as product workflows", async ({
    page,
  }) => {
    await page.goto("/internal/renewals");
    await expect(
      page.getByRole("heading", { level: 1, name: "Renewal notice windows" }),
    ).toBeVisible();
    await expect(page.getByText("Data provenance")).toHaveCount(0);
    await expect(page.getByText(/server pages?/)).toHaveCount(0);

    await page.goto("/internal/reports");
    await expect(
      page.getByRole("heading", { level: 1, name: "Operational reports" }),
    ).toBeVisible();
    await expect(page.getByText("Data provenance")).toHaveCount(0);
    await expect(page.getByText(/server pages?/)).toHaveCount(0);
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
      page.getByText("Template evidence is read only in this demo."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review template approval" }),
    ).toHaveCount(0);
    await expectAxeClean(page);
  });

  test("cannot approve finance price-book activation", async ({ page }) => {
    await page.goto("/internal/price-books");
    await expect(
      page.getByRole("heading", { level: 1, name: "Price books" }),
    ).toBeVisible();
    // The surface reads price books from the service database and shows an
    // empty table rather than fixtures when it cannot, so the review panel and
    // its role pill are present only when books load. The guarantee this test
    // exists for holds either way: legal is offered no control that could
    // activate a rate card.
    await expect(
      page.getByRole("button", { name: /approve|activate/i, disabled: false }),
    ).toHaveCount(0);
    const review = page.getByRole("button", {
      name: "Review price-book approval",
    });
    if (await review.count()) {
      await expect(review).toBeDisabled();
      await expect(page.getByText("Read only")).toBeVisible();
      await expect(
        page.getByText("Finance approval authority is required."),
      ).toBeVisible();
    }
  });
});

test.describe("destructive-action approver journey", () => {
  test.beforeEach(async ({ page }) =>
    usePersona(page, "destructive_action_approver"),
  );

  test("cannot decide the finance-only approval case", async ({ page }) => {
    await page.goto("/internal/approvals");
    await expect(
      page.getByRole("heading", { level: 1, name: "Approval decisions" }),
    ).toBeVisible();
    await expect(page.getByText("APR-DEMO-001").first()).toBeVisible();
    await expect(
      page.getByText(
        "Read only. An account owner or the assigned approver can act on this record.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Approve exception", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Reject exception", exact: true }),
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
      { path: "/internal", heading: "Operational health" },
      {
        path: "/internal/queues?view=sla-breached",
        heading: "Operational queues",
      },
      { path: "/internal/reports", heading: "Operational reports" },
      { path: "/internal/revenue", heading: "Revenue & channel" },
      { path: "/internal/status", heading: "Integration status" },
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
    const search = page.getByRole("button", { name: "Open command menu" });
    await expectTargetSize(search);
    await expectVisibleFocus(search);
    // Below the split-panel breakpoint the row opens the full-page detail, so
    // the primary target in the table is the record link rather than the
    // desktop row-select button.
    const record = page
      .getByRole("link", { name: /Collections aging decision/ })
      .first();
    await expectTargetSize(record);
    await expectVisibleFocus(record);
  });

  test("passes axe on representative operations, queue, and report surfaces", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of [
      "/internal",
      "/internal/queues",
      "/internal/reports",
      "/internal/revenue",
      "/internal/status",
    ]) {
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
