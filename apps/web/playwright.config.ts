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
const releaseShard = Boolean(process.env.CLOCKWORK_RELEASE_SHARD);
if (
  process.env.CLOCKWORK_RELEASE_SHARD === "ui" &&
  process.platform !== "darwin"
)
  throw new Error(
    "Release visual comparisons require the pinned Darwin runner used by the reviewed baselines.",
  );
const workerCount = serial ? 1 : releaseShard || process.env.CI ? 2 : undefined;

export default defineConfig({
  testDir: "./e2e",
  // Production proof owns its migrated database, signed session cookies, and
  // provider fake through the dedicated proof configuration.
  testIgnore: "production-proof.spec.ts",
  fullyParallel: !serial,
  forbidOnly: true,
  retries: 0,
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
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer:
      !process.env.CI && !process.env.CLOCKWORK_RELEASE_SHARD,
    timeout: 120_000,
  },
  projects: [
    {
      name: "functional-chromium",
      testIgnore: ["production-proof.spec.ts", "visual.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testMatch: "visual.spec.ts",
      dependencies: ["functional-chromium"],
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
