import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

// These journeys change the demo persona header between customer and partner
// sessions, so keeping this feature file serial avoids cross-route compilation
// and navigation races in the local Next development server.
test.describe.configure({ mode: "serial" });

const CUSTOMER_ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const OFFER = "Enterprise archive capacity";
const OFFER_PRICE_BOOK_ID = "44444444-4444-4444-8444-444444444444";

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
    page.getByRole("heading", { name: /Welcome back/ }),
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

test("owner builds a quote from the session account and issues one protected command", async ({
  page,
}) => {
  await usePersona(page, "owner");
  const commands: Array<Record<string, unknown>> = [];
  await page.route("**/api/v1/core/commands/quotes", async (route) => {
    expectProtectedMutation(route);
    const command = route.request().postDataJSON() as Record<string, unknown>;
    commands.push(command);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: command.id, status: "draft", version: 1 }),
    });
  });

  await page.goto("/quotes/new");
  await expect(
    page.getByRole("heading", { level: 1, name: "Create a quote" }),
  ).toBeVisible();
  // The account is fixed by the session; the builder never offers another one.
  await expect(page.getByLabel("Customer account")).toHaveValue(
    "Northstar Archive Labs",
  );

  await page.getByLabel("Offer", { exact: true }).fill(OFFER);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Capacity, term, route, end client or partner, and expiry",
    }),
  ).toBeVisible();
  await page.getByLabel("Committed capacity (TB)").fill("120");
  await page.getByLabel("Term (months)").fill("12");
  await page.getByLabel("Quote expiry").fill("2026-09-30T17:00");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(
    page.getByRole("heading", { level: 3, name: "Draft boundary" }),
  ).toBeVisible();
  const create = page.getByRole("button", { name: "Create priced draft" });
  await create.click();
  await expect(page.getByText(/Priced draft created/)).toBeVisible();
  // The created draft is not an open quote: the surface refuses to infer one.
  await expect(
    page.getByText(/issue it once its document is prepared/),
  ).toBeVisible();
  await expect(create).toBeDisabled();

  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({
    id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    accountId: CUSTOMER_ACCOUNT_ID,
    action: "create",
    payload: {
      priceBookId: OFFER_PRICE_BOOK_ID,
      route: "direct",
      lines: [
        {
          sku: "FIL-ARCHIVE-CAPACITY",
          region: "us-east",
          quantity: "120",
          termMonths: 12,
        },
      ],
    },
  });
});

test("owner reviews persisted agreement identity before the signing handoff", async ({
  page,
}) => {
  await usePersona(page, "owner");

  await page.goto("/agreements/AGR-2026-0042");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Cloud Service Agreement · version 3.2",
    }),
  ).toBeVisible();
  const artifacts = page.getByRole("region", { name: "Artifact chain" });
  await expect(artifacts.getByText("AGR-2026-0042")).toBeVisible();
  await expect(artifacts.getByText("3.2")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign this agreement" }),
  ).toHaveAttribute("href", /\/signing\/redirect\?agreementId=[0-9a-f-]{36}/);
  await expect(
    page.getByRole("group", { name: "Attach customer agreement paper" }),
  ).toBeVisible();
});

test("click-through acceptance stays closed until the approved template loads", async ({
  page,
}) => {
  await usePersona(page, "owner");

  await page.goto("/agreements/execute");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Review and accept agreement",
    }),
  ).toBeVisible();
  // Without the counsel-approved server record there is no exact text to bind,
  // so the surface offers no acceptance control at all.
  await expect(
    page.getByRole("heading", { name: "Agreement unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByText(/No legal acceptance action is available/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /accept/i })).toHaveCount(0);
});

test("owner reviews complete persisted order commitments before acceptance", async ({
  page,
}) => {
  await usePersona(page, "owner");
  await page.goto("/orders/accept");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Review resulting commitment",
    }),
  ).toBeVisible();
  // Both authoritative inputs keep their reference and version attached.
  await expect(
    page.getByText("Accepted quote Q-2026-0184-v3 · version 3"),
  ).toBeVisible();
  const review = page.getByRole("complementary", {
    name: "Review before accepting",
  });
  await expect(
    review.getByText("Enterprise committed capacity · version 3 · accepted"),
  ).toBeVisible();
  await expect(
    review.getByText("Cloud Service Agreement · version 3.2 · active"),
  ).toBeVisible();
  // Estimated spend is labeled as a quote calculation, not as billed value.
  await expect(
    page.getByText(/Estimated spend is a quote calculation/),
  ).toBeVisible();
});

test("order acceptance requires an explicit attestation before it binds", async ({
  page,
}) => {
  await usePersona(page, "owner");
  let accepted = false;
  await page.route("**/api/v1/core/commands/orders", async (route) => {
    accepted = true;
    await route.abort();
  });
  await page.goto("/orders/accept");
  await page.getByRole("textbox", { name: "Purchase order" }).fill("PO-77120");
  await page.getByRole("textbox", { name: "Service start" }).fill("2026-09-01");
  await page
    .getByRole("textbox", { name: "Authority title" })
    .fill("Director of Infrastructure");
  await page
    .getByRole("button", { name: "Accept order and create commitment" })
    .click();
  await expect(page.getByRole("checkbox")).toBeFocused();
  expect(accepted).toBe(false);
});

test("offboarding review reflects the selected named service", async ({
  page,
}) => {
  await usePersona(page, "owner");
  await page.goto("/account/offboarding");
  await expect(
    page.getByRole("heading", { level: 1, name: "Review service offboarding" }),
  ).toBeVisible();
  // The service list is the customer's persisted orders, named as the customer
  // knows them.
  const service = page.getByRole("combobox", { name: "Service", exact: true });
  const madrid = service.locator("option", {
    hasText: "Madrid compliance replica",
  });
  await service.selectOption((await madrid.getAttribute("value")) ?? "");
  await page
    .getByRole("combobox", { name: "Retrieval window" })
    .selectOption("60");
  await page
    .getByRole("textbox", { name: "Requested effective time" })
    .fill("2026-12-01T09:00");
  await page.getByRole("button", { name: "Review and confirm" }).click();

  const review = page.getByRole("complementary", { name: "Review impact" });
  await expect(review.getByText("Madrid compliance replica")).toBeVisible();
  await expect(review.getByText("60 days")).toBeVisible();
  await expect(
    review.getByText("Two distinct approvers required"),
  ).toBeVisible();
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
    page.getByRole("heading", { level: 1, name: "Create a partner quote" }),
  ).toBeVisible();
  const summary = page.getByRole("complementary", { name: "Quote summary" });
  await expect(summary.getByText("Halcyon Research Cooperative")).toBeVisible();
  await expect(summary.getByText("Meridian Channel Group")).toBeVisible();
  // Transfer pricing is a server calculation, so the builder refuses to state
  // one before the draft exists.
  await expect(
    summary.getByText("Server-priced after draft creation"),
  ).toBeVisible();
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
      page.getByRole("heading", { level: 1, name: "Create a quote" }),
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
