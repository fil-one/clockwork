import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const CUSTOMER_ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const OFFER = "Enterprise archive capacity";
const OFFER_PRICE_BOOK_ID = "44444444-4444-4444-8444-444444444444";

const journeys = [
  {
    persona: "direct buyer",
    role: "owner",
    path: "/dashboard",
    heading: "Good afternoon",
  },
  {
    persona: "referral partner",
    role: "partner_seller",
    path: "/partner",
    heading: "Partner desk",
  },
  {
    persona: "reseller",
    role: "partner_admin",
    path: "/partner/quotes",
    heading: "Partner & resale quotes",
  },
  {
    persona: "distributor",
    role: "partner_admin",
    path: "/partner/registrations",
    heading: "Deal registration",
  },
  {
    persona: "end client",
    role: "member",
    path: "/services",
    heading: "Orders & services",
  },
  {
    persona: "billing user",
    role: "billing",
    path: "/billing",
    heading: "Billing & payments",
  },
  {
    persona: "legal approver",
    role: "legal_approver",
    path: "/internal/agreements",
    heading: "Agreement templates",
  },
  {
    persona: "finance approver",
    role: "finance_approver",
    path: "/internal/reports",
    heading: "Operational reports",
  },
  {
    persona: "internal operator",
    role: "internal_operator",
    path: "/internal/queues",
    heading: "Operational queues",
  },
] as const;

for (const journey of journeys) {
  test(`${journey.persona} mocked journey is navigable and axe-clean`, async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({ "x-clockwork-persona": journey.role });
    await page.goto(journey.path);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      journey.heading,
    );
    await expect(page.getByText("Demo environment").first()).toBeVisible();
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });
}

test("billing user is denied quote mutation access", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-clockwork-persona": "billing" });
  await page.goto("/quotes/new");
  await expect(
    page.getByRole("heading", {
      name: "This view is not available to your role",
    }),
  ).toBeVisible();
});

test("new buyer registers a verified legal entity through the bootstrap contract", async ({
  page,
}) => {
  let registration: Record<string, unknown> | undefined;
  await page.route("**/api/v1/lifecycle/registrations", async (route) => {
    const request = route.request();
    expect(request.headers()["idempotency-key"]).toBeTruthy();
    expect(request.headers()["x-csrf-token"]).toBeTruthy();
    registration = request.postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "organization-demo", status: "pending" }),
    });
  });
  await page.goto(`/register?code=${"r".repeat(32)}`);
  await expect(page).toHaveURL(/\/register$/);
  await page.getByLabel("Legal entity name").fill("Northstar Labs");
  await page.getByLabel("Verified work email").fill("buyer@northstar.example");
  await page.getByLabel("Business domain").fill("northstar.example");
  await page.getByLabel("Registered address").fill("100 Main St");
  await page.getByLabel("City").fill("Boston");
  await page.getByLabel("Postal code").fill("02110");
  await page.getByLabel("Billing contact name").fill("Maya Chen");
  await page
    .getByLabel("Billing contact email")
    .fill("billing@northstar.example");
  await page.getByLabel("Invoice delivery email").fill("ap@northstar.example");
  await page.getByRole("button", { name: "Register organization" }).click();
  await expect(page.getByText("Registration accepted")).toBeVisible();
  expect(registration).toMatchObject({
    legalName: "Northstar Labs",
    businessDomain: "northstar.example",
    registrantEmail: "buyer@northstar.example",
    registrationToken: "r".repeat(32),
    relationshipRoles: ["direct_client"],
  });
});

test("direct buyer creates a quote draft through a protected, record-bound command", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "x-clockwork-persona": "owner" });
  let requestBody: Record<string, unknown> | undefined;
  await page.route("**/api/v1/core/commands/quotes", async (route) => {
    const request = route.request();
    expect(request.headers()["idempotency-key"]).toBeTruthy();
    expect(request.headers()["x-csrf-token"]).toBeTruthy();
    requestBody = request.postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: requestBody.id,
        status: "draft",
        version: 1,
      }),
    });
  });

  await page.goto("/quotes/new");
  await expect(
    page.getByRole("heading", { level: 1, name: "Create a quote" }),
  ).toBeVisible();
  await page.getByLabel("Offer", { exact: true }).fill(OFFER);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Committed capacity (TB)").fill("120");
  await page.getByLabel("Term (months)").fill("12");
  await page.getByLabel("Quote expiry").fill("2026-09-30T17:00");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create priced draft" }).click();
  await expect(
    page.getByText(/The server created the priced draft/),
  ).toBeVisible();
  expect(requestBody).toMatchObject({
    id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    accountId: CUSTOMER_ACCOUNT_ID,
    action: "create",
    payload: { priceBookId: OFFER_PRICE_BOOK_ID, route: "direct" },
  });
});

test("redirect signing creates an envelope without activating the agreement", async ({
  page,
}) => {
  let envelopeRequest: Record<string, unknown> | undefined;
  await page.route("**/api/experience/esign/launches", async (route) => {
    const request = route.request();
    expect(request.headers()["idempotency-key"]).toBeTruthy();
    expect(request.headers()["x-csrf-token"]).toBeTruthy();
    envelopeRequest = request.postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        envelopeId: "envelope-demo",
        status: "pending",
        signingUrl: "https://esign.clockwork.test/redirect/envelope-demo",
        returnState: "opaque-server-state",
      }),
    });
  });
  await page.goto("/signing/redirect");
  await page
    .getByLabel("Agreement ID")
    .fill("99999999-9999-4999-8999-999999999999");
  const continueButton = page.getByRole("button", {
    name: "Continue to secure signing",
  });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page.getByText(/Envelope accepted/)).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Continue to the approved e-sign provider",
    }),
  ).toHaveAttribute(
    "href",
    "https://esign.clockwork.test/redirect/envelope-demo",
  );
  expect(envelopeRequest).toMatchObject({
    mode: "redirect",
    agreementId: "99999999-9999-4999-8999-999999999999",
  });
});

test("billing prepares a Stripe handoff while payment truth remains webhook-derived", async ({
  page,
}) => {
  let payment: Record<string, unknown> | undefined;
  await page.route("**/api/v1/core/payment-sessions", async (route) => {
    const request = route.request();
    expect(request.headers()["idempotency-key"]).toBeTruthy();
    expect(request.headers()["x-csrf-token"]).toBeTruthy();
    payment = request.postDataJSON() as Record<string, unknown>;
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
  expect(payment).toBeUndefined();
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

test("internal assisted review names the immutable actor before starting a server session", async ({
  page,
}) => {
  let commandCalls = 0;
  await page.route("**/api/v1/core/commands/quotes", async (route) => {
    commandCalls += 1;
    await route.abort();
  });
  await page.setExtraHTTPHeaders({
    "x-clockwork-persona": "internal_operator",
  });
  await page.goto("/internal/assisted");
  await expect(
    page.getByRole("complementary", { name: "Assisted mode active" }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/Demo internal operator · operator@clockwork.test/),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: /Assisted-mode reason/ })
    .fill("Customer requested an attributed quote review.");
  await page.getByRole("button", { name: "Review assisted action" }).click();
  await expect(
    page.getByRole("heading", { name: "Assisted action review" }),
  ).toBeVisible();
  await expect(page.getByText("Assisted action not submitted")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start 15-minute assisted session" }),
  ).toBeVisible();
  expect(commandCalls).toBe(0);
});
