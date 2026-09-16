import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(
  process.env.CLOCKWORK_TEST_PORT ?? process.env.PORT ?? "3000",
  10,
);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("CLOCKWORK_TEST_PORT must be an unprivileged TCP port.");
}
const artifactRoot = path.resolve(
  process.env.CLOCKWORK_ARTIFACT_DIR ?? "test-results",
);
const serial = process.env.CLOCKWORK_RELEASE_SERIAL === "1";
if (
  (process.env.CLOCKWORK_RELEASE_SHARD === "ui" ||
    process.env.CLOCKWORK_RELEASE_SHARD === "demo") &&
  process.platform !== "darwin"
)
  throw new Error(
    "Release visual comparisons require the pinned Darwin runner used by the reviewed baselines.",
  );
/**
 * One worker, always. `ux-internal-ops.spec.ts` resets the durable demo store
 * through `resetDurableDemoState`, and there is exactly one store and one dev
 * server, so a parallel run pulls records out from under whichever sibling spec
 * happens to be mid-journey. Measured at the default worker count: one run in
 * three failed, a different pair of tests each time, every one of them passing
 * in isolation. Two workers has the same race, only less often, which is worse
 * because it reads as a real regression.
 *
 * This costs no wall clock. Three serial runs took 1.3 minutes each against
 * 1.1 to 1.4 parallel, because the shared dev server compiling routes is the
 * bottleneck rather than test execution. The extra workers were buying nothing.
 */
const workerCount = 1;

/**
 * The demo password gate redirects every non-exempt path, so the demo suite
 * cannot share a server with the suites that sign in directly, and Next refuses
 * a second dev server in the same app directory. The demo suite therefore runs
 * as its own shard, the way the production proof already does:
 *
 *   CLOCKWORK_DEMO_ACCESS_PASSWORD=<secret> \
 *     pnpm --filter @clockwork/web exec playwright test --project=demo-chromium
 *
 * Without the password the suite skips and the server keeps its ordinary
 * environment, so every other project is unaffected.
 */
const demoPassword = process.env.CLOCKWORK_DEMO_ACCESS_PASSWORD ?? "";
const demoSuite = Boolean(demoPassword);

export default defineConfig({
  testDir: "./e2e",
  // Every ordinary local browser run starts and finishes with the canonical
  // file-backed demo state. This keeps a prior interrupted mutation from
  // changing the next release proof. The password-gated demo shard owns its
  // own lifecycle and is deliberately excluded.
  ...(demoSuite ? {} : { globalSetup: "./e2e/local-demo.setup.ts" }),
  // Production proof owns its migrated database, signed session cookies, and
  // provider fake through the dedicated proof configuration.
  testIgnore: "production-proof.spec.ts",
  fullyParallel: !serial,
  forbidOnly: true,
  retries: 0,
  /**
   * Playwright's 5s default for an expectation assumes a server that only has
   * to answer. These suites run against `next dev`, which compiles a route the
   * first time anything asks for it, and compiles the server functions behind
   * an interaction the first time one is invoked.
   *
   * Measured against a cleared `.next` on an idle laptop, a cold route costs
   * 330ms to 2.67s where the same route costs 40ms to 220ms once warm. The
   * macos-15 runner walks these suites about four times slower than that
   * laptop (the demo project takes 6.4 minutes there against 1.3 to 1.8 here),
   * which puts the worst cold compile near thirteen seconds and charges it to
   * whichever expectation reaches that route first. Both macOS shards failed a
   * different arbitrary test on every run that way, always on a 5s
   * expectation, while the same specs passed locally; with `retries: 0` and
   * the customer-partner journeys serial, one failure skipped the 45 behind
   * it. 20s covers the measured worst case with room to spare, and applies
   * only on CI, so a local run still reports a stuck expectation in five
   * seconds.
   *
   * Deliberately not paired with a raised whole-test budget here. Over five
   * runs each, adding `timeout: 120_000` turned `demo.spec.ts` "demo reset"
   * from green into three failures: that test clicks the demo panel about a
   * second after navigating to it, and a busier machine loses the race against
   * hydration, so the click lands on an unhydrated button and the panel never
   * opens. The two projects that do need a longer test budget set it
   * themselves below.
   */
  ...(process.env.CI ? { expect: { timeout: 20_000 } } : {}),
  ...(workerCount ? { workers: workerCount } : {}),
  outputDir: path.join(artifactRoot, "playwright-output"),
  reporter: process.env.CI
    ? [
        ["github"],
        ["json", { outputFile: path.join(artifactRoot, "playwright.json") }],
      ]
    : [
        ["list"],
        ["json", { outputFile: path.join(artifactRoot, "playwright.json") }],
      ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm dev --hostname 127.0.0.1 --port ${port}`,
    url: demoSuite
      ? `http://127.0.0.1:${port}/demo/access`
      : `http://127.0.0.1:${port}/developers/openapi.json`,
    reuseExistingServer: process.env.CLOCKWORK_REUSE_TEST_SERVER === "1",
    timeout: 120_000,
    ...(demoSuite
      ? {
          env: {
            CLOCKWORK_DEMO_DEPLOY: "1",
            CLOCKWORK_EXPERIENCE_ADAPTER: "demo",
            CLOCKWORK_EVIDENCE_ADAPTER: "demo",
            CLOCKWORK_DEMO_ACCESS_PASSWORD: demoPassword,
          },
        }
      : {
          // Functional and visual journeys deliberately drive the local demo
          // projections. Naming both adapters here keeps `pnpm verify` explicit
          // without enabling the separately gated public demo deployment.
          env: {
            CLOCKWORK_EXPERIENCE_ADAPTER: "demo",
            CLOCKWORK_EVIDENCE_ADAPTER: "demo",
          },
        }),
  },
  projects: [
    {
      name: "functional-chromium",
      testIgnore: [
        "production-proof.spec.ts",
        "visual.spec.ts",
        "demo.spec.ts",
      ],
      // These specs set no per-test budget of their own, so they take the 30s
      // default, and one cold compile inside a multi-step journey is enough to
      // exceed it: that is how `ux-customer-partner.spec.ts` failed on CI with
      // "Test timeout of 30000ms exceeded". `demo.spec.ts` keeps the default
      // because it sets its own budget on every test that needs one.
      ...(process.env.CI ? { timeout: 90_000 } : {}),
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testMatch: "visual.spec.ts",
      dependencies: ["functional-chromium"],
      fullyParallel: false,
      ...(process.env.CI ? { timeout: 90_000 } : {}),
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "demo-chromium",
      testMatch: "demo.spec.ts",
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
