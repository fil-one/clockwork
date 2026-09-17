import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_SEED_VERSION } from "@clockwork/testing/demo-seed";

/**
 * The demo surfaces exist only behind the deploy opt-in and a configured
 * password, which the `demo` release shard mints per run. Release
 * qualification forbids a skipped test, so a missing password fails loudly
 * here rather than reporting an empty suite as coverage.
 */
function configuredPassword(): string {
  const configured = process.env.CLOCKWORK_DEMO_ACCESS_PASSWORD;
  if (!configured)
    throw new Error(
      "The demo suite requires CLOCKWORK_DEMO_ACCESS_PASSWORD. Run it through the demo release shard, or set the variable to drive a demo-configured server.",
    );
  return configured;
}

const password = configuredPassword();

/**
 * `playwright.config.ts` serves this suite a build on CI and `next dev`
 * everywhere else. Its condition is the password above and this one, and the
 * password is required here, so this is the same answer.
 */
const builtServer = Boolean(process.env.CI);

test("finance approves and cancels a future price schedule without retiring current pricing", async ({
  page,
}) => {
  test.setTimeout(90000);
  await passGate(page);
  await resetDemoData(page);
  try {
    await startAs(page, "Mateo Silva");
    await gotoHydrated(page, "/internal/price-books");
    const incumbent = page.getByRole("row", {
      name: /Direct commerce USD 2 USD.*Active/,
    });
    await expect(incumbent).toBeVisible();
    const picker = page.getByRole("combobox", { name: "Price book version" });
    await picker.fill("Future scheduled USD v9000");
    await picker.press("Tab");
    await page
      .getByLabel("Finance decision reason")
      .fill("Advance approval of the exact future economics and dates.");
    await page
      .getByRole("button", { name: "Review price-book approval" })
      .click();
    await expect(
      page.getByRole("button", { name: "Approve and activate" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Approve scheduled activation" })
      .click();
    await expect(
      page.getByText("Activation schedule · approved", { exact: true }),
    ).toBeVisible();
    await expect(incumbent).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit LOCKED-STORAGE-TB us-east-2" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Review price-book approval" }),
    ).toBeEnabled();
    await page
      .getByLabel("Finance decision reason")
      .fill("Cancel the future change and reopen it for a new review.");
    await page
      .getByRole("button", { name: "Review price-book approval" })
      .click();
    await page
      .getByRole("button", { name: "Cancel approved schedule" })
      .click();
    await expect(
      page.getByText("Activation schedule · cancelled", { exact: true }),
    ).toBeVisible();
    await expect(incumbent).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit LOCKED-STORAGE-TB us-east-2" }),
    ).toBeVisible();
  } finally {
    if (!page.isClosed()) await resetDemoData(page).catch(() => undefined);
  }
});

/**
 * A page served by `next dev` can finish its document load before the dev
 * runtime connects; capturing in that interval lets Chromium's full-page
 * metrics retain the wordmark's 3,863px intrinsic width even after the
 * stylesheet visibly clamps it. Waiting for the runtime's connection event
 * isolates screenshots from that development-only bootstrap without sleeping or
 * retrying the assertion.
 *
 * A built server has no such bootstrap and logs no such event, so there is
 * nothing to wait for. `playwright.config.ts` decides which server this run
 * gets, on the same signal.
 */
function nextDevRuntimeReady(page: Page): Promise<unknown> {
  if (builtServer) return Promise.resolve();
  return page.waitForEvent("console", {
    predicate: (message) => message.text() === "[HMR] connected",
  });
}

/**
 * `next dev` mounts its indicator in a `nextjs-portal` element, which would
 * otherwise sit in the corner of a full-page capture. A built server mounts
 * none, and its Content-Security-Policy refuses an inline style without the
 * per-request nonce, so there is nothing to hide and no way to inject the rule
 * that would hide it.
 */
async function hideDevOverlay(page: Page) {
  if (builtServer) return;
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
}

async function expectVisualLayoutReady(page: Page, viewportWidth: number) {
  const wordmark = page.locator("img.cw-brand-logo[data-mark='wordmark']");
  await expect(wordmark).toBeVisible();
  await wordmark.evaluate(async (image) => {
    if (!(image instanceof HTMLImageElement))
      throw new Error("The demo wordmark must render as an image.");
    await image.decode();
  });
  await page.evaluate(() => document.fonts.ready);

  await expect
    .poll(
      () =>
        page.evaluate(async (expectedWidth) => {
          const measure = () => {
            const main = document.querySelector("main#main-content");
            const logo = document.querySelector<HTMLImageElement>(
              "img.cw-brand-logo[data-mark='wordmark']",
            );
            const stylesLoaded = [...document.styleSheets].every(
              (sheet) => !sheet.href || sheet.ownerNode?.isConnected,
            );
            return {
              stylesLoaded,
              viewportWidth: document.documentElement.clientWidth,
              documentWidth: document.documentElement.scrollWidth,
              mainDisplay: main ? getComputedStyle(main).display : "missing",
              logoWidth: logo?.getBoundingClientRect().width ?? 0,
            };
          };

          const first = measure();
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          const second = measure();
          const ready = (value: ReturnType<typeof measure>) =>
            value.stylesLoaded &&
            value.viewportWidth === expectedWidth &&
            value.documentWidth === expectedWidth &&
            value.mainDisplay === "grid" &&
            value.logoWidth > 0 &&
            value.logoWidth <= 120;
          return (
            ready(first) &&
            ready(second) &&
            first.logoWidth === second.logoWidth
          );
        }, viewportWidth),
      { message: "demo CSS and viewport metrics must settle before capture" },
    )
    .toBe(true);
}

async function expectAxeClean(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}

async function openGate(page: Page, next = "/demo") {
  await page.goto(next);
  await expect(page).toHaveURL(/\/demo\/access/u);
  return page.getByLabel("Password");
}

async function passGate(page: Page, next = "/demo") {
  const field = await openGate(page, next);
  const destination = new URL(next, page.url()).href;
  await field.fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  // The gate submits asynchronously. A click alone does not establish its
  // cookie; wait before issuing any protected command such as demo reset.
  await expect(page).toHaveURL(destination);
}

/**
 * Resets the same durable demo store the panel resets, but without navigating.
 * The flagship journey uses this once before it begins so a prior interrupted
 * local run cannot decide which orders it sees. Its visible final reset still
 * goes through the panel, exactly as the deployment runbook instructs.
 */
async function resetDemoData(page: Page) {
  const result = await page.evaluate(async () => {
    const token =
      document.cookie
        .split(";")
        .map((part) => part.trim().split("="))
        .find(([key]) => key === "clockwork-csrf")
        ?.slice(1)
        .join("=") ?? "";
    const response = await fetch("/api/demo/reset", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-csrf-token": token } : {}),
      },
      body: "{}",
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type") ?? "";
    const receipt: unknown = contentType.includes("application/json")
      ? await response.json()
      : null;
    return {
      ok: response.ok,
      status: response.status,
      redirected: response.redirected,
      receipt,
    };
  });
  expect(
    result,
    "demo reset must return a receipt for the gated session",
  ).toMatchObject({
    ok: true,
    status: 200,
    redirected: false,
    receipt: { target: "demo", seedVersion: DEMO_SEED_VERSION },
  });
}

/**
 * A visible control is server-rendered markup. Its click handler exists only
 * once React has attached, and a click or a fill issued before that is written
 * to markup no component is listening to and is silently lost: the surface
 * never changes, and the next expectation waits out its whole budget for a
 * confirmation nothing is producing. Three consecutive `demo` shards on main
 * failed that way, a different journey each time, all of them at a
 * `toBeVisible` on the result of an interaction rather than at the interaction
 * itself. The shell sets `data-hydrated` from a mount effect, so it is the
 * signal that the handlers exist.
 *
 * Every document load needs it: a `goto`, a `reload`, and the persona redirect
 * that lands on a fresh surface. A client transition inside the shell does not,
 * because React renders and attaches that surface in one commit.
 */
async function expectShellHydrated(page: Page) {
  await expect(page.locator(".experience-shell")).toHaveAttribute(
    "data-hydrated",
    "true",
  );
}

async function gotoHydrated(page: Page, destination: string) {
  await page.goto(destination);
  await expectShellHydrated(page);
}

async function reloadHydrated(page: Page) {
  await page.reload();
  await expectShellHydrated(page);
}

/**
 * Starting a persona is a redirect that establishes the HttpOnly identity
 * cookie and lands on that persona's home surface. A `goto` issued before the
 * redirect completes cancels it and keeps the previous identity, so waiting for
 * the surface it produced is both the identity guarantee and the hydration one.
 */
async function startAs(page: Page, name: string) {
  await page.getByRole("link", { name: `Start as ${name}` }).click();
  await expectShellHydrated(page);
}

test.describe("demo access gate", () => {
  test("refuses the wrong password and keeps the return path", async ({
    page,
  }) => {
    const field = await openGate(page, "/dashboard");
    await field.fill("not-the-password");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page).toHaveURL(/error=1/u);
    await expect(
      page.getByText("That password does not match. Try again."),
    ).toBeVisible();
    // A refused attempt must not carry the visitor past the gate.
    await expect(page).toHaveURL(/\/demo\/access/u);
    await expectAxeClean(page);
  });

  test("opens the landing page on the right password", async ({ page }) => {
    await passGate(page);

    await expect(page).toHaveURL(/\/demo$/u);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Choose the person you are signing in as",
      }),
    ).toBeVisible();
  });
});

test.describe("demo landing", () => {
  test.beforeEach(async ({ page }) => {
    await passGate(page);
  });

  test("groups every persona and starts one", async ({ page }) => {
    await expect(
      page.getByRole("heading", { level: 2, name: "Customers and partners" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Fil One staff" }),
    ).toBeVisible();
    // Nine personas, each its own card with a start link.
    await expect(page.getByRole("link", { name: /^Start as / })).toHaveCount(9);
    await expectAxeClean(page);

    const start = page.getByRole("link", { name: /^Start as / }).first();
    await start.click();
    await expect(page).not.toHaveURL(/\/demo$/u);
    await expectShellHydrated(page);
  });

  test("carries the persona into the panel and switches from it", async ({
    page,
  }) => {
    // Mara Voss is the direct buyer, whose journey has two steps, so the list
    // has both a current step and a later one.
    await startAs(page, "Mara Voss");

    await page.getByRole("button", { name: "Open demo controls" }).click();
    const panel = page.getByRole("complementary", { name: "Demo controls" });
    await expect(panel.getByLabel("Signed in as")).toBeVisible();
    // The journey renders as ordered steps with the current one marked.
    await expect(panel.locator("li[data-state]")).not.toHaveCount(0);
    await expect(panel.locator("[aria-current='step']")).toHaveCount(1);

    await panel.getByLabel("Signed in as").selectOption({ index: 1 });
    await expect(page.locator(".experience-shell")).toBeVisible();
  });
});

test.describe("direct buyer flagship journey", () => {
  test("carries the guided renewal through its bound PDF and created order", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await passGate(page);
    await resetDemoData(page);

    try {
      await page.getByRole("link", { name: "Start as Mara Voss" }).click();
      // Netlify preserves this selector on redirects; identity still comes
      // from the HttpOnly persona cookie. Allow only that exact known suffix.
      await expect(page).toHaveURL(/\/dashboard(?:\?persona=directBuyer)?$/u);
      await expectShellHydrated(page);

      await page.getByRole("button", { name: "Open demo controls" }).click();
      const panel = page.getByRole("complementary", { name: "Demo controls" });
      await expect(panel.getByLabel("Signed in as")).toBeVisible();
      await expect(panel.getByLabel("Signed in as")).toHaveValue("directBuyer");
      await panel
        .getByRole("link", {
          name: "Review the issued version and proceed to acceptance.",
        })
        .click();
      await expect(page).toHaveURL(/\/quotes\/quote-direct-renewal-v2$/u);
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: /Annual renewal · committed capacity/u,
        }),
      ).toBeVisible();
      await expect(
        page
          .locator("main#main-content > header")
          .getByText("Issued · awaiting acceptance", { exact: true }),
      ).toBeVisible();

      await page.getByRole("link", { name: "Review and accept order" }).click();
      await expect(page).toHaveURL(
        /\/orders\/accept\?quote=quote-direct-renewal-v2$/u,
      );
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "Review resulting commitment",
        }),
      ).toBeVisible();
      // The promise chain names the quote by the state it is actually in at
      // this point: issued, and not yet accepted. `f1050bf` ("Correct accepted
      // quote and order lifecycle presentation", #55) renamed the label from
      // "Accepted quote" for exactly that reason.
      await expect(
        page.getByText("Issued quote Q-2026-0312 · version 2"),
      ).toBeVisible();

      await page
        .getByRole("textbox", { name: "Purchase order" })
        .fill("PO-DEMO-0312");
      await page
        .getByRole("textbox", { name: "Service start" })
        .fill("2027-01-01");
      await page
        .getByRole("textbox", { name: "Service end" })
        .fill("2027-12-31");
      await page
        .getByRole("textbox", { name: "Authority title" })
        .fill("Operations Director");
      await page
        .getByRole("checkbox", {
          name: /service start, service end, and resulting commitment/u,
        })
        .check();
      await page
        .getByRole("button", { name: "Accept order and create commitment" })
        .click();

      const orderForm = page.getByRole("link", { name: "Open the order form" });
      await expect(orderForm).toBeVisible({ timeout: 20_000 });
      const orderFormHref = await orderForm.getAttribute("href");
      expect(orderFormHref).toMatch(
        /^\/api\/experience\/artifacts\/order_form\//u,
      );
      if (!orderFormHref)
        throw new Error("the rendered order form has no href");
      const pdf = await page.request.get(orderFormHref);
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()["content-type"]).toContain("application/pdf");
      expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

      await page
        .getByRole("button", { name: "Create the order and commitment" })
        .click();
      await expect(
        page.getByText(
          "Order created. Its commitment and provisioning state are now authoritative.",
        ),
      ).toBeVisible();
      const createdOrder = page.getByRole("link", {
        name: "Open the created order",
      });
      const createdOrderHref = await createdOrder.getAttribute("href");
      expect(createdOrderHref).toMatch(/^\/orders\/order-[0-9a-f-]+$/u);
      if (!createdOrderHref)
        throw new Error("the created-order confirmation has no href");
      // Creation refreshes the server projection behind this client component,
      // which can replace the success link after its authoritative href has
      // been read. Open that exact offered destination instead of racing the
      // refresh against a click on a detached DOM node.
      await page.goto(createdOrderHref);
      await expect(page).toHaveURL(/\/orders\/order-[0-9a-f-]+$/u);
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: /Committed capacity · PO-DEMO-0312/u,
        }),
      ).toBeVisible();
      // A just-accepted order is not yet provisioned, so it does not claim to
      // be active. `2f4f640` ("Complete demo quote revisions and partner
      // document issuance", #54) replaced "Active · accepted in this session"
      // with the state the record is actually in.
      await expect(
        page
          .locator("main#main-content > header")
          .getByText("Accepted · awaiting provisioning", { exact: true }),
      ).toBeVisible();

      await gotoHydrated(page, "/quotes/quote-direct-renewal-v2");
      await expect(
        page
          .locator("main#main-content > header")
          .getByText("Accepted · order created", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Review and accept order" }),
      ).toHaveCount(0);

      await page.getByRole("button", { name: "Open demo controls" }).click();
      await page
        .getByRole("complementary", { name: "Demo controls" })
        .getByRole("button", { name: "Restore demo data" })
        .click();
      const confirm = page.getByRole("dialog");
      await confirm.getByRole("button", { name: "Reset demo" }).click();
      await expect(
        page
          .locator("main#main-content > header")
          .getByText("Issued · awaiting acceptance", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Review and accept order" }),
      ).toBeVisible();
      await page.goto(createdOrderHref);
      await expect(
        page.getByRole("heading", { name: "That page is not available" }),
      ).toBeVisible();
    } finally {
      // Keep cleanup best-effort so it never hides the journey's own failure.
      if (!page.isClosed()) await resetDemoData(page).catch(() => undefined);
    }
  });
});

test.describe("playable product-demo workflows", () => {
  test("finance exports and imports reviewed economics into a fresh draft", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await passGate(page);
    await resetDemoData(page);
    try {
      await startAs(page, "Mateo Silva");
      await gotoHydrated(page, "/internal/price-books");
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download price book" }).click();
      const download = await downloadPromise;
      const path = await download.path();
      if (!path) throw new Error("Download path missing");
      const json = await readFile(path, "utf8");
      await page
        .getByText("Import price-book JSON into a new draft", { exact: true })
        .click();
      const editor = page.getByLabel("Price-book JSON", { exact: true });
      await editor.fill(json);
      await page
        .getByRole("button", { name: "Validate import preview" })
        .click();
      await expect(
        page.getByRole("table", { name: "Imported rate preview" }),
      ).toBeVisible();
      await editor.fill(json + " invalid");
      await expect(
        page.getByRole("button", { name: "Create imported draft" }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "Validate import preview" })
        .click();
      await expect(
        page.getByRole("button", { name: "Create imported draft" }),
      ).toHaveCount(0);
      await editor.fill(json);
      await page
        .getByRole("button", { name: "Validate import preview" })
        .click();
      const form = page.getByRole("form", { name: "Import price book" });
      await form
        .getByLabel("Imported price-book name")
        .fill("Browser imported USD");
      await form.getByLabel("Imported price-book version").fill("98");
      await form
        .getByLabel("Import reason")
        .fill("Review exported economics as a separately approved new draft");
      await form.getByRole("button", { name: "Create imported draft" }).click();
      await expect(
        page.getByRole("row", {
          name: /Browser imported USD 98 USD.*Draft Not proposed/,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("table", { name: "Rate card economics" }),
      ).toContainText("LOCKED-STORAGE-TB");
      await page
        .getByLabel("Finance decision reason")
        .fill("Fresh review of imported regional pricing and mappings");
      await page
        .getByRole("button", { name: "Review price-book approval" })
        .click();
      await expect(
        page.getByRole("button", { name: "Approve and activate" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Propose activation" }),
      ).toBeEnabled();
    } finally {
      if (!page.isClosed()) await resetDemoData(page).catch(() => undefined);
    }
  });

  test("finance clones a proposal, edits its independent draft, and preserves the source", async ({
    page,
  }) => {
    test.setTimeout(90000);
    await passGate(page);
    await resetDemoData(page);
    try {
      await startAs(page, "Mateo Silva");
      await gotoHydrated(page, "/internal/price-books");
      const source = page.getByRole("row", {
        name: /Direct commerce USD 3 USD.*Proposed by commercial.policy@filone.test/,
      });
      await expect(source).toBeVisible();
      const originalEconomics = await page
        .getByRole("table", { name: "Rate card economics" })
        .innerText();
      await page
        .getByText("Clone this version into a draft", { exact: true })
        .click();
      const cloning = page.getByRole("form", { name: "Clone price book" });
      await cloning
        .getByLabel("Cloned price-book name")
        .fill("Browser cloned USD");
      await cloning.getByLabel("Cloned price-book version").fill("99");
      await cloning
        .getByLabel("Clone reason")
        .fill("Independent regional refresh from reviewed source economics.");
      await cloning
        .getByRole("button", { name: "Create cloned draft" })
        .click();
      await expect(
        page.getByRole("row", {
          name: /Browser cloned USD 99 USD.*1 Draft Not proposed/,
        }),
      ).toBeVisible();
      await expect(source).toBeVisible();
      await page
        .getByRole("button", { name: "Edit LOCKED-STORAGE-TB us-east-2" })
        .click();
      await page.getByLabel("Unit price · USD").fill("159.00");
      await page.getByRole("button", { name: "Save rate card" }).click();
      await expect(
        page
          .getByRole("table", { name: "Rate card economics" })
          .getByText("USD 159.00", { exact: true }),
      ).toBeVisible();
      await page
        .getByLabel("Finance decision reason")
        .fill("Copied draft independently reviewed after editing.");
      await page
        .getByRole("button", { name: "Review price-book approval" })
        .click();
      await expect(
        page.getByRole("button", { name: "Approve and activate" }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Propose activation" }).click();
      await expect(
        page.getByRole("row", {
          name: /Browser cloned USD 99 USD.*Proposed by finance.approver@filone.test/,
        }),
      ).toBeVisible();
      const picker = page.getByRole("combobox", { name: "Price book version" });
      await picker.fill("Direct commerce USD v3");
      await picker.press("Tab");
      await expect
        .poll(() =>
          page.getByRole("table", { name: "Rate card economics" }).innerText(),
        )
        .toBe(originalEconomics);
      await expect(source).toBeVisible();
    } finally {
      if (!page.isClosed()) await resetDemoData(page).catch(() => undefined);
    }
  });
  test("finance authors a priced draft, proposes it, and activates a second-authority version", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await passGate(page);
    await resetDemoData(page);

    try {
      await startAs(page, "Mateo Silva");
      await gotoHydrated(page, "/internal/price-books");
      await expect(
        page.getByRole("heading", { level: 1, name: "Price books" }),
      ).toBeVisible();

      const authoring = page.getByRole("region", {
        name: "Author a priced draft",
      });
      await authoring.getByLabel("Price-book name").fill("Browser proof USD");
      await authoring.getByLabel("Currency").selectOption("USD");
      await authoring.getByLabel("Version").fill("1");
      await authoring.getByLabel("Effective from").fill("2026-09-01");
      await authoring
        .getByRole("button", { name: "Create draft and continue" })
        .click();
      await expect(
        page.getByText(
          "Draft metadata recorded. Add its first rate card next.",
        ),
      ).toBeVisible();

      await authoring.getByLabel("SKU").fill("BROWSER-PROOF-TB");
      await authoring.getByLabel("Region").fill("us-east-2");
      await authoring.getByLabel("Unit price · USD").fill("150.00");
      await authoring.getByLabel("Floor price · USD").fill("100.00");
      await authoring.getByLabel("Overage rate · USD").fill("180.00");
      await authoring.getByLabel("Stripe tax code").fill("txcd_10103000");
      await authoring
        .getByLabel("Approved commercial claim")
        .fill("Browser proof of the guided finance authoring workflow.");
      await authoring.getByRole("button", { name: "Add rate card" }).click();
      await expect(
        page.getByText(
          "Rate card saved. Reopen this draft to add or edit more rates, then review before proposing activation.",
        ),
      ).toBeVisible();
      await expect(
        page
          .getByRole("table", {
            name: "Price book versions and activation readiness",
          })
          .getByRole("row", { name: /Browser proof USD/ }),
      ).toBeVisible();

      await page
        .getByLabel("Finance decision reason")
        .fill("Browser proof pricing reviewed against policy CP-2.");
      await page
        .getByRole("button", { name: "Review price-book approval" })
        .click();
      await page.getByRole("button", { name: "Propose activation" }).click();
      await expect(
        page.getByRole("row", {
          name: /Browser proof USD.*Proposed by finance\.approver@filone\.test/,
        }),
      ).toBeVisible();

      // The public demo has one interactive finance persona, so it cannot
      // impersonate a second approver for the draft Mateo just proposed. The
      // seeded v3 proposal is authored by a distinct finance identity and lets
      // Mateo exercise the same two-authority activation decision honestly.
      const versionPicker = page.getByRole("combobox", {
        name: "Price book version",
      });
      await versionPicker.fill("Direct commerce USD v3");
      await versionPicker.press("Tab");
      await page
        .getByLabel("Finance decision reason")
        .fill(
          "Independent browser approval after reviewing the seeded proposal.",
        );
      await page
        .getByRole("button", { name: "Review price-book approval" })
        .click();
      await page.getByRole("button", { name: "Approve and activate" }).click();
      await expect(
        page.getByRole("row", { name: /Direct commerce USD 3 USD.*Active/ }),
      ).toBeVisible();
    } finally {
      if (!page.isClosed()) await resetDemoData(page).catch(() => undefined);
    }
  });

  test("finance reviews PAYG minimum and high-egress estimates before approving a fictional policy", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await passGate(page);
    await resetDemoData(page);
    try {
      await startAs(page, "Mateo Silva");
      await gotoHydrated(page, "/internal/payg-offers");
      await expect(page.getByText(/Fictional policy workspace/)).toBeVisible();
      await page
        .getByRole("button", { name: /Fictional PAYG review scenario/ })
        .click();
      await page
        .getByRole("button", { name: "Calculate monthly estimate" })
        .click();
      await expect(
        page.getByText(/Estimated monthly total: USD 4.99/),
      ).toBeVisible();
      await page.getByLabel("Average daily storage (TB)").fill("10");
      await page.getByLabel("Total monthly egress (TB)").fill("100");
      await page
        .getByRole("button", { name: "Calculate monthly estimate" })
        .click();
      await expect(
        page.getByText(/Estimated monthly total: USD 49.90/),
      ).toBeVisible();
      await page
        .getByLabel("Decision reason")
        .fill("Browser QA minimum and high-egress review.");
      await page
        .getByLabel("Approval evidence reference")
        .fill("demo-browser-policy-review");
      await page
        .getByRole("button", { name: "Approve policy version" })
        .click();
      await expect(
        page.getByText(
          "Policy version 1 is approved. Sales activation is unchanged.",
        ),
      ).toBeVisible();
      await reloadHydrated(page);
      await page
        .getByRole("button", { name: /Fictional PAYG review scenario/ })
        .click();
      await expect(
        page.getByRole("heading", {
          name: /Fictional PAYG review scenario · approved/,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Approve policy version" }),
      ).toHaveCount(0);
      await page.setViewportSize({ width: 320, height: 800 });
      await expectAxeClean(page);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    } finally {
      if (!page.isClosed()) await resetDemoData(page).catch(() => undefined);
    }
  });

  test("approved fictional channel controls survive a fresh page read", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await passGate(page);
    await resetDemoData(page);
    try {
      await startAs(page, "Mateo Silva");
      await gotoHydrated(page, "/internal/channel-policy");
      const approval = page.getByRole("group", { name: "Approve policy" });
      await approval
        .getByLabel("Decision reason")
        .fill("Browser QA review of requested protection limits.");
      await approval
        .getByLabel("Approval evidence reference")
        .fill("demo-browser-channel-review");
      await approval.getByRole("button", { name: "Approve policy" }).click();
      await expect(page.getByText(/Approved policy v1/)).toBeVisible();
      await page.reload();
      await expect(page.getByText(/Approved policy v1/)).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Approve policy" }),
      ).toHaveCount(0);
      await page.setViewportSize({ width: 320, height: 800 });
      await expectAxeClean(page);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    } finally {
      if (!page.isClosed()) await resetDemoData(page).catch(() => undefined);
    }
  });

  test("operator refreshes stale queue projections through the secured demo route", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await passGate(page);
    await resetDemoData(page);

    try {
      await startAs(page, "Ada Mercer");
      await gotoHydrated(page, "/internal/queues");
      const refresh = page.getByRole("button", { name: "Refresh data" });
      await expect(refresh).toBeVisible();
      const [response] = await Promise.all([
        page.waitForResponse(
          (candidate) =>
            candidate.url().endsWith("/api/demo/projections/queues/refresh") &&
            candidate.request().method() === "POST",
        ),
        refresh.click(),
      ]);
      expect(response.status()).toBe(200);
      await expect(
        page.getByRole("button", { name: "Refresh data" }),
      ).toHaveCount(0);
      await expect(
        page.getByText("At least one record is past its refresh window."),
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", { level: 1, name: "Operational queues" }),
      ).toBeVisible();
    } finally {
      if (!page.isClosed()) await resetDemoData(page).catch(() => undefined);
    }
  });

  test("partner registration, priced quote, and renewal decisions remain visible", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await passGate(page);
    await resetDemoData(page);

    try {
      await startAs(page, "Priya Nair");

      await gotoHydrated(page, "/partner/registrations");
      await page.getByLabel("End client").fill("Aster House Media");
      await page
        .getByRole("option", { name: "Aster House Media", exact: true })
        .click();
      await page.getByLabel("Workload").fill("Browser archive expansion");
      await page.getByLabel("Expected volume (TB)").fill("40");
      await page.getByRole("button", { name: "Register the deal" }).click();
      await expect(
        page.getByText(
          /Registration submitted and added to the decision queue/,
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("row", {
          name: /Aster House Media · Browser archive expansion/,
        }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole("row", {
          name: /Aster House Media · Browser archive expansion/,
        }),
      ).toBeVisible();

      await gotoHydrated(page, "/partner/quotes/new");
      await page
        .getByLabel("Offer and price book")
        .fill("LOCKED-STORAGE-TB · uk-south · Partner commerce GBP (GBP)");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByLabel("Committed capacity (TB)").fill("40");
      await page.getByLabel("Term (months)").fill("12");
      await page.getByLabel("End client").fill("Aster House Media");
      await page
        .getByLabel("Partner resale price (GBP major units)")
        .fill("60000");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Create priced draft" }).click();
      // The builder's own success status, plus the link it can only offer once
      // the server returned a priced draft id. `2d842b2` moved this copy into
      // `partner.quote.new.success` and `c8683e3` (#51) added the link.
      await expect(
        page.getByRole("status").getByText(/The priced draft was created/),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Open the created draft" }),
      ).toBeVisible();
      await page.goto("/partner/quotes");
      await expect(
        page.locator("tbody").getByRole("link", {
          name: "Aster House Media · LOCKED-STORAGE-TB",
        }),
      ).toBeVisible();

      await gotoHydrated(page, "/partner/renewals");
      await page
        .getByRole("button", { name: "Review Halcyon Research Cooperative" })
        .click();
      await page.getByRole("checkbox").check();
      await page
        .getByRole("button", { name: "Confirm renewal request" })
        .click();
      await expect(
        page.getByText(/Renewal request submitted\. The current term remains/),
      ).toBeVisible();
      await page.reload();
      await expect(
        page
          .getByText(
            "Renewal request submitted · awaiting Fil One confirmation",
          )
          .first(),
      ).toBeVisible();
    } finally {
      if (!page.isClosed()) await resetDemoData(page).catch(() => undefined);
    }
  });

  test("customer notification preferences persist across a fresh server read", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await passGate(page);
    await resetDemoData(page);

    try {
      await startAs(page, "Mara Voss");
      await gotoHydrated(page, "/account/notifications");
      const preference = page.getByRole("checkbox", {
        name: /Quote expiry warnings/,
      });
      await expect(preference).toBeChecked();
      // This controlled checkbox stays checked while the durable write is in
      // flight, so click it and wait on the server-confirmed outcome.
      await preference.click();
      await expect(
        page.getByText(
          "Quote expiry warnings will no longer be sent to this account.",
        ),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole("checkbox", { name: /Quote expiry warnings/ }),
      ).not.toBeChecked();
      await expect(page.getByText("Stored choice: off.")).toBeVisible();
    } finally {
      if (!page.isClosed()) await resetDemoData(page).catch(() => undefined);
    }
  });

  test("billing user completes a no-money sandbox payment and returns to its receipt", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await passGate(page);
    await resetDemoData(page);

    try {
      await startAs(page, "Theo Grant");
      await gotoHydrated(page, "/billing/invoice-meridian-overdue");
      await expect(
        page.getByText("Guided demo · payment sandbox"),
      ).toBeVisible();
      await page
        .getByRole("checkbox", {
          name: /understand this is a demo-only payment simulation/,
        })
        .check();
      await page
        .getByRole("button", { name: "Start demo sandbox checkout" })
        .click();
      await page.getByRole("button", { name: "Complete demo payment" }).click();
      await expect(page.getByText(/Demo payment complete/)).toBeVisible();
      await expect(page.getByText(/No money moved/)).toBeVisible();
      await page.getByRole("link", { name: "Return to paid invoice" }).click();
      await expect(
        page
          .getByLabel("Commercial summary")
          .getByText("Paid · demo sandbox", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(/Demo receipt .*sandbox only.*no money moved/i),
      ).toBeVisible();
      await expect(page.getByText("Guided demo · payment sandbox")).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("button", { name: "Start demo sandbox checkout" }),
      ).toHaveCount(0);
    } finally {
      if (!page.isClosed()) await resetDemoData(page).catch(() => undefined);
    }
  });
});

// The demo pages live behind the password gate, so their baselines are taken
// here rather than in visual.spec.ts, which drives the ungated server.
for (const viewport of [
  { label: "desktop", width: 1440, height: 1000 },
  { label: "320", width: 320, height: 800 },
] as const) {
  test(`visual demo access at ${viewport.label}`, async ({ page }) => {
    const runtimeReady = nextDevRuntimeReady(page);
    await page.setViewportSize(viewport);
    await openGate(page);
    await runtimeReady;
    await hideDevOverlay(page);
    await expectVisualLayoutReady(page, viewport.width);
    await expect(page).toHaveScreenshot(
      `demo-access${viewport.label === "320" ? "-320" : ""}.png`,
      { animations: "disabled", fullPage: true, maxDiffPixelRatio: 0.01 },
    );
  });

  test(`visual demo landing at ${viewport.label}`, async ({ page }) => {
    const runtimeReady = nextDevRuntimeReady(page);
    await page.setViewportSize(viewport);
    await passGate(page);
    await expect(page.getByRole("link", { name: /^Start as / })).toHaveCount(9);
    await runtimeReady;
    await hideDevOverlay(page);
    await expectVisualLayoutReady(page, viewport.width);
    await expect(page).toHaveScreenshot(
      `demo-landing${viewport.label === "320" ? "-320" : ""}.png`,
      { animations: "disabled", fullPage: true, maxDiffPixelRatio: 0.01 },
    );
  });
}

test.describe("demo reset", () => {
  test("confirms once and restores seeded data", async ({ page }) => {
    await passGate(page);
    await page
      .getByRole("link", { name: /^Start as / })
      .first()
      .click();
    await expectShellHydrated(page);

    await page.evaluate(() =>
      window.localStorage.setItem("clockwork-demo:probe", "dirty"),
    );

    await page.getByRole("button", { name: "Open demo controls" }).click();
    const panel = page.getByRole("complementary", { name: "Demo controls" });
    // One reset lives in the panel; the sidebar footer no longer carries a copy.
    await expect(
      panel.getByRole("button", { name: "Restore demo data" }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Reset demo", exact: true }),
    ).toHaveCount(0);

    await panel.getByRole("button", { name: "Restore demo data" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm).toBeVisible();
    await Promise.all([
      page.waitForEvent("framenavigated", {
        predicate: (frame) => frame === page.mainFrame(),
      }),
      confirm.getByRole("button", { name: "Reset demo" }).click(),
    ]);

    // The action clears local state and then reloads, so the probe disappears
    // once the main-frame navigation settles rather than on the click itself.
    expect(
      await page.evaluate(() =>
        window.localStorage.getItem("clockwork-demo:probe"),
      ),
    ).toBeNull();
    await expect(page.locator(".experience-shell")).toBeVisible();
  });
});

test("customer trial, paid conversion and cancellation retain verified handoff states", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await passGate(page);
  await resetDemoData(page);
  const startPersona = async (
    name: string,
    persona: "directBuyer" | "financeApprover",
    destination: string,
  ) => {
    await page.goto("/demo");
    await page.getByRole("link", { name: `Start as ${name}` }).click();
    // The redirect establishes the HttpOnly identity cookie. A second goto
    // before it completes can cancel sign-in and retain the previous role.
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === destination &&
        (url.search === "" || url.search === `?persona=${persona}`),
    );
    await expectShellHydrated(page);
    await page.getByRole("button", { name: "Open demo controls" }).click();
    const panel = page.getByRole("complementary", { name: "Demo controls" });
    await expect(panel.getByLabel("Signed in as")).toHaveValue(persona);
  };
  const customer = async () => {
    await startPersona("Mara Voss", "directBuyer", "/dashboard");
    await gotoHydrated(page, "/buy/payg");
  };
  const financeHandoff = async () => {
    await startPersona("Mateo Silva", "financeApprover", "/internal/approvals");
    await gotoHydrated(page, "/internal/payg-requests");
    await page
      .getByLabel("Resolution reason")
      .fill(
        "Fictional verified handoff confirmed by finance for this demo request",
      );
    await page
      .getByRole("button", { name: "Simulate verified handoff" })
      .click();
    await expect(
      page.getByText(
        "Fictional handoff recorded in demo state. No provider or billing action occurred.",
      ),
    ).toBeVisible();
  };
  try {
    await customer();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await expectAxeClean(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(
      page.getByRole("heading", { name: "PAYG and trials", exact: true }),
    ).toBeVisible();
    await page.getByRole("radio", { name: "Trial request" }).check();
    await expect(
      page.getByRole("button", { name: "Accept terms and request trial" }),
    ).toBeDisabled();
    await page.getByRole("checkbox", { name: /I have read and agree/ }).check();
    await page
      .getByRole("button", { name: "Accept terms and request trial" })
      .click();
    await expect(
      page.getByText("Pending verified handoff", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Accept terms and request trial" }),
    ).toBeDisabled();
    await page.reload();
    await expect(
      page.getByText("Pending verified handoff", { exact: true }),
    ).toBeVisible();
    await financeHandoff();
    await customer();
    await page.getByRole("button", { name: "Review PAYG conversion" }).click();
    await expect(
      page.getByRole("heading", { name: "Review paid conversion" }),
    ).toBeFocused();
    await page.getByRole("checkbox", { name: /I have read and agree/ }).check();
    await page
      .getByRole("button", { name: "Accept paid terms and request conversion" })
      .click();
    await expect(
      page.getByText("Pending verified handoff", { exact: true }),
    ).toBeVisible();
    await financeHandoff();
    await customer();
    await expect(page.getByText(/Trial conversion confirmed/)).toBeVisible();
    await page
      .getByLabel("Cancellation reason")
      .fill("The demo customer no longer needs the service");
    await page
      .getByRole("button", { name: "Request cancellation", exact: true })
      .click();
    await expect(
      page.getByText(
        "Cancellation requested. Service and billing continue until the provider confirms the service end.",
      ),
    ).toBeVisible();
    await financeHandoff();
    await customer();
    await expect(page.getByText(/Service end confirmed/).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Request cancellation", exact: true }),
    ).toHaveCount(0);
  } finally {
    if (!page.isClosed()) await resetDemoData(page).catch(() => undefined);
  }
});
