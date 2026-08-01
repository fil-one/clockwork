import { expect, test, type Page, type Route } from "@playwright/test";
import { createHash } from "node:crypto";

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

test("owner dashboard leads with decisions and one commercial term", async ({
  page,
}) => {
  await usePersona(page, "owner");
  await page.goto("/dashboard");

  await expect(
    page.getByRole("heading", { name: "Needs attention" }),
  ).toBeVisible();
  for (const name of ["Invoice", "Notice and renewal", "Quote", "Provisioning"])
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Current commercial term" }),
  ).toHaveCount(1);
  await expect(page.getByText("Service term rollup")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Decisions at a glance" }),
  ).toBeVisible();
  await expect(page.getByText(/Updated 18 minutes ago/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recent activity" }),
  ).toBeVisible();
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

test("owner creates a validated three-stage quote draft with canonical IDs", async ({
  page,
}) => {
  await usePersona(page, "owner");
  let command: Record<string, unknown> | undefined;
  await page.route("**/api/v1/core/commands/quotes", async (route) => {
    expectProtectedMutation(route);
    command = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        record: {
          id: command.id,
          resource: "quotes",
          rowVersion: 1,
          data: command,
        },
        auditEventId: "audit-quote",
        outboxEventId: "outbox-quote",
      }),
    });
  });

  await page.goto("/quotes/new");
  await expect(
    page.getByText("Offer and region", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  const capacity = page.getByLabel("Committed capacity (TB)");
  await capacity.fill("4");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/at least 10 TB/)).toBeVisible();
  await expect(capacity).toBeFocused();
  await capacity.fill("120");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByText("Review and issue", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create priced draft" }).click();
  await expect(page.getByText(/current server status is draft/i)).toBeVisible();

  expect(command).toMatchObject({
    action: "create",
    accountId: "11111111-1111-4111-8111-111111111111",
    payload: {
      priceBookId: "44444444-4444-4444-8444-444444444444",
      route: "direct",
      lines: [{ quantity: "120", termMonths: 12 }],
    },
  });
});

test("owner reviews title, version, and authority before agreement acceptance", async ({
  page,
}) => {
  await usePersona(page, "owner");
  const exactText = "Cloud Service Agreement\nVersion 3.2\n";
  const exactTextHash = createHash("sha256").update(exactText).digest("hex");
  let acceptance: Record<string, unknown> | undefined;
  await page.route(
    "**/api/v1/lifecycle/agreement-templates/active?**",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "55555555-5555-4555-8555-555555555555",
          type: "csa",
          semanticVersion: "3.2",
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
      expectProtectedMutation(route);
      acceptance = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "agreement-demo", status: "executed" }),
      });
    },
  );

  await page.goto("/agreements/execute");
  await expect(
    page.getByRole("heading", {
      name: "Cloud Service Agreement · version 3.2",
    }),
  ).toBeVisible();
  await expect(page.getByText(exactText)).toBeVisible();
  await page.getByRole("checkbox", { name: /authorized to bind/i }).check();
  await page.getByRole("button", { name: "Accept and execute" }).click();
  await expect(
    page.getByText(/recorded the authority evidence/i),
  ).toBeVisible();
  expect(acceptance).toMatchObject({
    templateVersion: "3.2",
    exactTextHash,
    authorityAttested: true,
  });
});

test("owner confirms the complete order commitment before acceptance", async ({
  page,
}) => {
  await usePersona(page, "owner");
  let command: Record<string, unknown> | undefined;
  await page.route("**/api/v1/core/commands/orders", async (route) => {
    expectProtectedMutation(route);
    command = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        record: {
          id: command.id,
          resource: "orders",
          rowVersion: 1,
          data: command,
        },
        auditEventId: "audit-order",
        outboxEventId: "outbox-order",
      }),
    });
  });

  await page.goto("/orders/accept");
  await expect(
    page.getByText(/Compliance replica renewal · version 2 · accepted/),
  ).toBeVisible();
  await expect(
    page.getByText(/Cloud Service Agreement · version 3.2 · active/),
  ).toBeVisible();
  const submit = page.getByRole("button", {
    name: "Accept order and create commitment",
  });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByRole("checkbox")).toBeFocused();
  await page.getByRole("checkbox").check();
  await submit.click();
  await expect(page.getByText(/server created the order/i)).toBeVisible();
  expect(command).toMatchObject({
    action: "create",
    payload: {
      authorityAttested: true,
      poNumber: "PO-NA-1092",
      serviceStartsOn: "2026-08-15",
    },
  });
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
  await page.goto("/partner/portfolio");
  const search = page.getByPlaceholder("Search end clients");
  await search.fill("Halcyon");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/q=Halcyon/);
  await expect(
    page.getByRole("link", { name: "Halcyon Research Cooperative" }),
  ).toBeVisible();
  await page.goto("/partner/billing");
  await expect(
    page.getByRole("heading", { name: /not available to your role/i }),
  ).toBeVisible();
});

test("partner seller creates a reviewed resale quote from names while IDs stay technical", async ({
  page,
}) => {
  await usePersona(page, "partner_seller");
  let command: Record<string, unknown> | undefined;
  await page.route("**/api/v1/core/commands/quotes", async (route) => {
    expectProtectedMutation(route);
    command = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        record: {
          id: command.id,
          resource: "quotes",
          rowVersion: 1,
          data: command,
        },
        auditEventId: "audit-resale",
        outboxEventId: "outbox-resale",
      }),
    });
  });

  await page.goto("/partner/quotes/new");
  await expect(page.getByLabel("Offer and price book")).toHaveValue(
    /US committed archive/,
  );
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("End client")).toHaveValue(
    "Halcyon Research Cooperative",
  );
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/Partner resale price:/).first()).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create priced draft" }).click();
  await expect(
    page.getByText(/Draft created from server pricing/i),
  ).toBeVisible();
  expect(command).toMatchObject({
    action: "create",
    accountId: "33333333-3333-4333-8333-333333333333",
    payload: {
      priceBookId: "44444444-4444-4444-8444-444444444444",
      endClientAccountId: "33333333-3333-4333-8333-333333333333",
      partnerAccountId: "22222222-2222-4222-8222-222222222222",
      route: "resale",
    },
  });
});

test("partner admin reviews financial boundaries before requesting renewal", async ({
  page,
}) => {
  await usePersona(page, "partner_admin");
  let renewal: Record<string, unknown> | undefined;
  await page.route(
    "**/api/v1/lifecycle/renewals/**/requests",
    async (route) => {
      expectProtectedMutation(route);
      renewal = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "renewal-demo", status: "requested" }),
      });
    },
  );

  await page.goto("/partner/renewals");
  await page.getByRole("button", { name: "Review Halcyon renewal" }).click();
  await expect(
    page.getByText(/Clockwork transfer price: \$91,200/),
  ).toBeVisible();
  await expect(page.getByText(/Partner resale price: \$112,000/)).toBeVisible();
  await expect(page.getByText(/Merchant of record: Meridian/)).toBeVisible();
  const confirm = page.getByRole("button", { name: "Confirm renewal request" });
  await expect(confirm).toBeDisabled();
  await page.getByRole("checkbox").check();
  await confirm.click();
  await expect(
    page.getByText(/current term remains authoritative/i),
  ).toBeVisible();
  expect(renewal).toEqual({
    accountId: "33333333-3333-4333-8333-333333333333",
    requestedAction: "renew",
    requestedTermMonths: 12,
  });
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 720 },
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
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);

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
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
  });
}
