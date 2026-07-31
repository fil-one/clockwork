import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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

test("direct buyer builds a quote with validation and recovery", async ({
  page,
}) => {
  await page.goto("/quotes/new");
  const capacity = page.getByRole("textbox", {
    name: "Committed capacity",
    exact: true,
  });
  const save = page.getByRole("button", { name: "Save changes" });
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
  await expect(page.getByText("Changes saved")).toBeVisible();
});

test("redirect signing returns a verified document", async ({ page }) => {
  await page.goto("/signing/redirect");
  const continueButton = page.getByRole("button", {
    name: "Continue to secure signing",
  });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page.getByText("Signature verified")).toBeVisible();
});
