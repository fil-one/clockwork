import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

// These journeys change the demo persona header between customer and partner
// sessions, so keeping this feature file serial avoids cross-route compilation
// and navigation races in the local Next development server.
test.describe.configure({ mode: "serial" });

async function usePersona(page: Page, role: string) {
  await page.setExtraHTTPHeaders({ "x-clockwork-persona": role });
}

function expectProtectedMutation(route: Route) {
  const headers = route.request().headers();
  expect(headers["idempotency-key"]).toBeTruthy();
  expect(headers["x-csrf-token"]).toBeTruthy();
}

async function expectAccessible(page: Page) {
  await expect(page).toHaveTitle(/Fil One Commerce/);
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations).toEqual([]);
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

test("owner dashboard leads with decisions and one commercial term", async ({
  page,
}) => {
  await usePersona(page, "owner");
  await page.goto("/dashboard");

  await expect(
    page.getByRole("heading", { name: "Needs attention" }),
  ).toBeVisible();
  for (const name of ["Invoice", "Notice and renewal", "Quote"])
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Northstar annual term" }),
  ).toHaveCount(1);
  await expect(page.getByText("Service term rollup")).toBeVisible();
  const supportingContext = page.getByText(
    "Usage and recent account activity",
    { exact: true },
  );
  await supportingContext.click();
  await expect(page.getByText(/refreshed 18 minutes ago/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recent activity" }),
  ).toBeVisible();
  await expectAccessible(page);
});

test("member keeps read access without owner-only customer actions", async ({
  page,
}) => {
  await usePersona(page, "member");
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: /Good afternoon/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Create quote" })).toHaveCount(0);
  await expect(
    page.getByText(/owner or administrator can create quotes/i),
  ).toBeVisible();

  await page.goto(
    "/services?q=madrid&status=provisioning&risk=medium&owner=Service%20operations&sort=title_asc&view=compact&page=1&pageSize=5",
  );
  await expect(
    page.getByRole("heading", { name: "Orders & services" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Madrid compliance replica" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/q=madrid/);
  await expect(page).toHaveURL(/pageSize=5/);
});

test("owner starts a quote from an authorized projection with an optimistic version", async ({
  page,
}) => {
  await usePersona(page, "owner");
  let command: Record<string, unknown> | undefined;
  await page.route(
    "**/api/experience/projections/customer/quotes/**/actions**",
    async (route) => {
      expectProtectedMutation(route);
      command = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          id: "action-quote",
          projectionId: command.projectionId,
          aggregateType: "quotes",
          aggregateId: "quote-demo",
          action: command.action,
          expectedVersion: command.expectedVersion,
          status: "queued",
          createdAt: "2026-07-31T16:00:00.000Z",
          auditEventId: "audit-quote",
          outboxMessageId: "outbox-quote",
        }),
      });
    },
  );

  await page.goto("/quotes/new");
  await expect(
    page.getByRole("heading", { level: 1, name: "Quote workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Enterprise committed capacity" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "accept", exact: true }).click();
  await expect(page.getByText("accept queued")).toBeVisible();
  expect(command).toMatchObject({
    action: "accept",
    expectedVersion: 3,
    projectionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    payload: {},
  });
});

test("owner reviews persisted agreement identity before the signing handoff", async ({
  page,
}) => {
  await usePersona(page, "owner");

  await page.goto("/agreements/execute");
  await expect(
    page.getByRole("heading", { level: 1, name: "Choose an agreement" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cloud Service Agreement" }),
  ).toBeVisible();
  await expect(
    page.getByText("Reference AGR-2026-0042 · version 3.2", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign this authorized agreement" }).first(),
  ).toHaveAttribute("href", /\/signing\/redirect\?agreementId=[0-9a-f-]{36}/);
  await expect(
    page.getByRole("group", { name: "Attach evidence" }).first(),
  ).toBeVisible();
});

test("owner reviews complete persisted order commitments before acceptance", async ({
  page,
}) => {
  await usePersona(page, "owner");
  await page.goto("/orders/accept");
  await expect(
    page.getByRole("heading", { level: 1, name: "Order acceptance" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Northstar primary archive" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Madrid compliance replica" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Reference ORD-2026-0098 · version 1/),
  ).toBeVisible();
  await expect(page.getByText("Read only")).toHaveCount(2);
});

test("offboarding review reflects the selected named service", async ({
  page,
}) => {
  await usePersona(page, "owner");
  await page.goto("/account/offboarding");
  await expect(
    page.getByRole("heading", { level: 1, name: "Account offboarding" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Restore sample timing" }),
  ).toBeVisible();
  await expect(page.getByText("Reference SUP-18421 · version 1")).toBeVisible();
  await expect(page.getByText("Read only")).toHaveCount(4);
});

test("billing prepares a safe provider handoff while payment truth stays webhook-derived", async ({
  page,
}) => {
  await usePersona(page, "billing");
  let payment: Record<string, unknown> | undefined;
  await page.route("**/api/v1/core/payment-sessions", async (route) => {
    expectProtectedMutation(route);
    payment = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "stripe",
        sessionId: "in_demo",
        invoiceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        url: "https://invoice.stripe.com/i/acct_demo/in_demo",
        status: "requires_customer_action",
      }),
    });
  });

  await page.goto("/billing/INV-2026-0781");
  await expect(
    page.getByText("Awaiting provider confirmation").first(),
  ).toBeVisible();
  await expect(
    page.getByText(/Reported by the payment provider webhook/),
  ).toBeVisible();
  const prepare = page.getByRole("button", { name: "Prepare secure payment" });
  await prepare.click();
  await expect(page.getByRole("checkbox")).toBeFocused();
  await page.getByRole("checkbox").check();
  await prepare.click();
  await expect(
    page.getByRole("link", { name: "Continue to secure Stripe payment" }),
  ).toHaveAttribute("href", "https://invoice.stripe.com/i/acct_demo/in_demo");
  expect(payment).toEqual({
    accountId: "11111111-1111-4111-8111-111111111111",
    invoiceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  });
});

test("partner seller can search the named portfolio but cannot open partner billing", async ({
  page,
}) => {
  await usePersona(page, "partner_seller");
  await page.goto("/partner");
  const desk = page.locator("#main-content");
  await expect(desk.getByText("1 actions", { exact: true })).toBeVisible();
  await expect(desk.getByRole("link", { name: "Credit exposure" })).toHaveCount(
    0,
  );
  await expect(desk.getByText("Collected commission")).toHaveCount(0);
  await expect(
    desk.getByRole("rowheader", { name: "Atlas Field Imaging" }),
  ).toBeVisible();
  await expect(
    desk.getByRole("heading", { name: "Commercial boundary" }),
  ).toBeVisible();

  await page.goto("/partner/portfolio");
  const search = page.getByPlaceholder("Search end clients");
  await search.fill("Halcyon");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/q=Halcyon/);
  await expect(
    page.getByRole("link", { name: "Halcyon Research Cooperative" }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.goto("/partner/billing");
  await expect(
    page.getByRole("heading", { name: /not available to your role/i }),
  ).toBeVisible();
});

test("partner collection state survives reload and browser history", async ({
  page,
}) => {
  await usePersona(page, "partner_admin");
  await page.goto("/partner/portfolio");
  const filters = page.getByRole("form", { name: "Filters" });
  const search = filters.getByRole("searchbox", { name: "Search" });
  await search.fill("Halcyon");
  await filters.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/q=Halcyon/);

  await page.reload();
  await expect(search).toHaveValue("Halcyon");
  await filters
    .getByRole("combobox", { name: "Risk", exact: true })
    .selectOption("medium");
  await expect(page).toHaveURL(/risk=medium/);

  await page.goBack();
  await expect(page).toHaveURL(/q=Halcyon/);
  await expect(page).not.toHaveURL(/risk=medium/);
  await expect(
    filters.getByRole("combobox", { name: "Risk", exact: true }),
  ).toHaveValue("all");

  await page.goForward();
  await expect(page).toHaveURL(/risk=medium/);
  await expect(search).toHaveValue("Halcyon");
});

test("partner seller starts resale work only from authorized persisted records", async ({
  page,
}) => {
  await usePersona(page, "partner_seller");
  await page.goto("/partner/quotes/new");
  await expect(
    page.getByRole("heading", { level: 1, name: "Partner quote task" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Halcyon archive expansion" }),
  ).toBeVisible();
  await expect(
    page.getByText("Reference PQ-2026-0184-v3 · version 1"),
  ).toBeVisible();
  await expect(page.getByText("Read only")).toHaveCount(3);
});

test("partner admin reviews financial boundaries before any renewal request", async ({
  page,
}) => {
  await usePersona(page, "partner_admin");
  await page.goto("/partner/renewals");
  await page
    .getByRole("button", { name: "Review Halcyon Research Cooperative" })
    .click();
  const renewalReview = page.getByRole("region", {
    name: "Review renewal before confirming",
  });
  await expect(
    renewalReview.getByText("$91,200 transfer / $112,000 resale", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/Redwood Channel Group on resale routes/),
  ).toBeVisible();
  const confirm = page.getByRole("button", { name: "Confirm renewal request" });
  await expect(confirm).toBeDisabled();
  await page.getByRole("checkbox").check();
  await expect(confirm).toBeDisabled();
  await expect(
    renewalReview.getByText(/merchant-of-record boundary/i),
  ).toBeVisible();
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 800 },
]) {
  test(`customer and partner priority layouts avoid overflow at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await usePersona(page, "owner");
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: "Needs attention" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto("/quotes/new");
    await expect(
      page.getByRole("heading", { level: 1, name: "Quote workspace" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto("/orders/ORD-2026-0112");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Madrid compliance replica",
      }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await usePersona(page, "partner_admin");
    await page.goto("/partner");
    const clock = page.getByRole("heading", {
      name: "Partner agreement clock",
    });
    const urgent = page.getByRole("heading", { name: "Urgent partner work" });
    await expect(clock).toBeVisible();
    await expect(urgent).toBeVisible();
    const clockBox = await clock.boundingBox();
    const urgentBox = await urgent.boundingBox();
    expect(clockBox?.y).toBeLessThan(urgentBox?.y ?? Number.POSITIVE_INFINITY);
    await expectNoHorizontalOverflow(page);

    await page.goto("/partner/portfolio");
    await expect(
      page.getByRole("heading", { level: 1, name: "End-client portfolio" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}
