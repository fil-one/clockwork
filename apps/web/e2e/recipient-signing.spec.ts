import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const id = "019a44ac-0000-7000-8000-000000000004";
const ready = {
  title: "Mutual NDA: Fil One and Northstar",
  recipientName: "Alex Morgan",
  state: "ready",
  testMode: true,
  canDownload: false,
};

test("private-link exchange recovers, hides the token, and waits for server-confirmed completion", async ({
  page,
}) => {
  let attempts = 0;
  let state = "ready";
  const exchanged: string[] = [];
  await page.route(`**/sign/${id}/*`, async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1);
    if (action === "access") {
      exchanged.push(route.request().postData() ?? "");
      if (attempts++ === 0) {
        await route.fulfill({
          status: 503,
          json: { code: "SIGNING_UNAVAILABLE" },
        });
        return;
      }
    }
    if (action === "launch") {
      await route.fulfill({
        json: { url: "https://www.signwell.com/docs/recipient-test/" },
      });
      return;
    }
    if (action === "refresh") state = "signed";
    await route.fulfill({ json: { ...ready, state } });
  });
  // Provider transport is deliberately stubbed. This tests our wrapper's
  // behavior, not the actual SignWell ceremony or account branding.
  await page.route("https://static.signwell.com/assets/embedded.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    window.SignWellEmbed = class {
      constructor(options) { this.options = options; }
      open() {
        if (location.hash || !this.options.showHeader || this.options.allowRedirect) throw new Error('Unsafe embed configuration');
        const button = document.createElement('button'); button.textContent = 'Provider completion event';
        button.onclick = () => this.options.events.completed();
        document.getElementById(this.options.containerId).append(button);
        // The real recipient view can emit iframeLoaded without documentLoaded.
        this.options.events.iframeLoaded();
      }
      close() { document.getElementById(this.options.containerId)?.replaceChildren(); }
    };`,
    }),
  );
  await page.goto(`/sign/${id}#private-test-capability`);
  await expect(
    page.getByRole("alert").filter({ hasText: "We couldn’t confirm" }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review your agreement", exact: true }),
  ).toBeVisible();
  expect(exchanged).toEqual([
    "private-test-capability",
    "private-test-capability",
  ]);
  await page.getByRole("button", { name: "Review and sign" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Loading" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Provider completion event" }).click();
  await expect(
    page.getByRole("heading", { name: "Your signature is complete" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /download/i })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Your agreement is complete" }),
  ).toHaveCount(0);
});

test("recipient preview is accessible and fits a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign/preview");
  await expect(
    page.getByRole("button", { name: "Review and sign" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Review and sign" }).click();
  await expect(
    page.getByText("Illustrative preview. No signature is captured."),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Finish preview" }).click();
  await expect(
    page.getByRole("heading", { name: "Your signature is complete" }),
  ).toBeVisible();
});
