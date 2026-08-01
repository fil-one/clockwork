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

export default defineConfig({
  testDir: "./e2e",
  // Production proof owns its migrated database, signed session cookies, and
  // provider fake through the dedicated proof configuration.
  testIgnore: "production-proof.spec.ts",
  fullyParallel: !serial,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  ...(serial ? { workers: 1 } : process.env.CI ? { workers: 2 } : {}),
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
