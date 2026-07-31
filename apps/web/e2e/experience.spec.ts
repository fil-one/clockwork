import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";

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
    heading: "Agreement & customer-paper",
  },
  {
    persona: "finance approver",
    role: "finance_approver",
    path: "/internal/reports",
    heading: "Reports & reconciliation",
  },
  {
    persona: "internal operator",
    role: "internal_operator",
    path: "/internal/queues",
    heading: "Exception queues",
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

test("direct buyer executes terms, creates a quote, and accepts the order through generated operations", async ({
  page,
}) => {
  const exactText = "Cloud Service Agreement\nVersion 1.0.0\n";
  const exactTextHash = createHash("sha256")
    .update(exactText, "utf8")
    .digest("hex");
  const operations: { path: string; body: Record<string, unknown> }[] = [];
  await page.route(
    "**/api/v1/lifecycle/agreement-templates/active?**",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "55555555-5555-4555-8555-555555555555",
          type: "csa",
          semanticVersion: "1.0.0",
          jurisdiction: "US",
          effectiveOn: "2026-01-01",
          canonicalDocumentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          exactText,
          exactTextHash,
          executionMode: "click_through",
        }),
      });
    },
  );
  await page.route(
    "**/api/v1/lifecycle/agreements/click-through",
    async (route) => {
      const request = route.request();
      expect(request.headers()["idempotency-key"]).toBeTruthy();
      expect(request.headers()["x-csrf-token"]).toBeTruthy();
      operations.push({
        path: new URL(request.url()).pathname,
        body: request.postDataJSON() as Record<string, unknown>,
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "agreement-demo", status: "executed" }),
      });
    },
  );
  await page.route("**/api/v1/core/commands/**", async (route) => {
    const request = route.request();
    expect(request.headers()["idempotency-key"]).toBeTruthy();
    expect(request.headers()["x-csrf-token"]).toBeTruthy();
    const body = request.postDataJSON() as Record<string, unknown>;
    operations.push({ path: new URL(request.url()).pathname, body });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        record: {
          id: body.id,
          resource: new URL(request.url()).pathname.split("/").at(-1),
          rowVersion: 1,
          data: body.payload,
        },
        auditEventId: "audit-demo",
        outboxEventId: "outbox-demo",
      }),
    });
  });

  await page.goto("/agreements/execute");
  await expect(page.getByLabel("Exact agreement text")).toHaveValue(exactText);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Submit securely" }).click();
  await expect(
    page.getByText(/server record is now the source of truth/i),
  ).toBeVisible();

  await page.goto("/quotes/new");
  const capacity = page.getByRole("textbox", {
    name: "Committed capacity",
    exact: true,
  });
  const save = page.getByRole("button", { name: "Submit securely" });
  await expect(save).toBeEnabled();
  await capacity.fill("4");
  await save.click();
  await expect(
    page.getByText("Enter a committed capacity of at least 10 TB.", {
      exact: true,
    }),
  ).toBeVisible();
  await capacity.fill("120");
  await save.click();
  await expect(
    page.getByText(/server record is now the source of truth/i),
  ).toBeVisible();

  await page.goto("/orders");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Submit securely" }).click();
  await expect(
    page.getByText(/server record is now the source of truth/i),
  ).toBeVisible();

  expect(operations.map((operation) => operation.path)).toEqual([
    "/api/v1/lifecycle/agreements/click-through",
    "/api/v1/core/commands/quotes",
    "/api/v1/core/commands/orders",
  ]);
  expect(operations[0]?.body).toMatchObject({
    authorityAttested: true,
    exactTextHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(operations[1]?.body).toMatchObject({
    action: "create",
    payload: { route: "direct" },
  });
  expect(operations[2]?.body).toMatchObject({
    action: "create",
    payload: { authorityAttested: true, poNumber: "PO-2026-0042" },
  });
});

test("redirect signing creates an envelope without activating the agreement", async ({
  page,
}) => {
  let envelopeRequest: Record<string, unknown> | undefined;
  await page.route(
    "**/api/v1/lifecycle/agreements/envelopes",
    async (route) => {
      const request = route.request();
      expect(request.headers()["idempotency-key"]).toBeTruthy();
      expect(request.headers()["x-csrf-token"]).toBeTruthy();
      envelopeRequest = request.postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "envelope-demo",
          status: "requested",
          signingUrl: "https://esign.clockwork.test/redirect/envelope-demo",
        }),
      });
    },
  );
  await page.goto("/signing/redirect");
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
    signerEmail: "maya@northstar.example",
  });
});

test("billing opens a Stripe session while payment truth remains webhook-derived", async ({
  page,
}) => {
  let payment: Record<string, unknown> | undefined;
  await page.route("**/api/v1/core/payment-sessions", async (route) => {
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
  await page.goto("/billing");
  await page.getByRole("button", { name: "Open secure payment" }).click();
  await expect(
    page.getByText(/Invoice status changes only after Stripe confirms/i),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Continue to secure Stripe payment" }),
  ).toHaveAttribute("href", "https://invoice.stripe.com/i/acct_demo/in_demo");
  expect(payment).toEqual({
    accountId: "11111111-1111-4111-8111-111111111111",
    invoiceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  });
});

test("internal assisted quote uses the concrete quote command", async ({
  page,
}) => {
  let command: Record<string, unknown> | undefined;
  await page.route("**/api/v1/core/commands/quotes", async (route) => {
    command = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        record: {
          id: "88888888-8888-4888-8888-888888888888",
          resource: "quotes",
          rowVersion: 1,
          data: {},
        },
        auditEventId: "audit-assisted",
        outboxEventId: "outbox-assisted",
      }),
    });
  });
  await page.goto("/internal/assisted");
  await expect(page.getByText(/server—not this form—records/i)).toBeVisible();
  await page
    .getByRole("checkbox", { name: /active assisted session/i })
    .check();
  await page.getByRole("button", { name: "Create assisted quote" }).click();
  await expect(
    page.getByText(/server record is now the source of truth/i),
  ).toBeVisible();
  expect(command).toMatchObject({
    accountId: "11111111-1111-4111-8111-111111111111",
    action: "create",
    payload: { route: "direct" },
  });
  expect(command).not.toHaveProperty("actor");
});
