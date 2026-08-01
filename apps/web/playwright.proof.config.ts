import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(
  process.env.CLOCKWORK_TEST_PORT ?? process.env.PORT ?? "3100",
  10,
);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("CLOCKWORK_TEST_PORT must be an unprivileged TCP port.");
const baseURL = `http://localhost:${port}`;
const providerFakePort = Number.parseInt(
  process.env.CLOCKWORK_PROVIDER_FAKE_PORT ?? "34000",
  10,
);
if (
  !Number.isInteger(providerFakePort) ||
  providerFakePort < 1024 ||
  providerFakePort > 65535 ||
  providerFakePort === port
)
  throw new Error(
    "CLOCKWORK_PROVIDER_FAKE_PORT must be a distinct unprivileged TCP port.",
  );
const providerFakeURL = `http://127.0.0.1:${providerFakePort}`;
process.env.CLOCKWORK_PROVIDER_FAKE_URL = providerFakeURL;
const artifactRoot = path.resolve(
  process.env.CLOCKWORK_ARTIFACT_DIR ?? "test-results/proof",
);
const secret = process.env.CLOCKWORK_PROOF_AUTH_SECRET;
if (!secret || Buffer.byteLength(secret) < 32)
  throw new Error("CLOCKWORK_PROOF_AUTH_SECRET is required for release proof");
for (const name of [
  "DATABASE_URL",
  "CLOCKWORK_SERVICE_DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "AUTHORIZATION_CONTEXT_SECRET",
] as const) {
  if (!process.env[name])
    throw new Error(`${name} is required for the production release proof`);
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "production-proof.spec.ts",
  // The three projects share one authoritative database fixture. One worker
  // keeps cross-persona mutation evidence deterministic while other browser
  // and unit shards remain parallel at the release-suite level.
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  globalSetup: "./e2e/production-proof.setup.ts",
  globalTeardown: "./e2e/production-proof.teardown.ts",
  outputDir: path.join(artifactRoot, "playwright-output"),
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(artifactRoot, "playwright.json") }],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `node e2e/production-provider-fake.mjs --port=${providerFakePort}`,
      url: `${providerFakeURL}/health`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      command: `pnpm start --hostname localhost --port ${port}`,
      url: `${baseURL}/access/session-expired`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        NODE_ENV: "production",
        CLOCKWORK_ENV: "production",
        NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV: "production",
        APP_ORIGIN: baseURL,
        NEXT_PUBLIC_APP_URL: baseURL,
        CLOCKWORK_CANONICAL_ORIGIN: baseURL,
        CLOCKWORK_EXPERIENCE_ADAPTER: "database",
        CLOCKWORK_RELEASE_PROOF: "1",
        CLOCKWORK_PROOF_AUTH_SECRET: secret,
        CLOCKWORK_PROVIDER_FAKE_URL: providerFakeURL,
        INTERNAL_EMAIL_DOMAINS:
          process.env.INTERNAL_EMAIL_DOMAINS ?? "clockwork.test",
      },
    },
  ],
  projects: [
    {
      name: "customer-proof",
      testMatch: /production-proof\.spec\.ts/,
      grep: /@customer/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: path.join(artifactRoot, "auth/customer.json"),
      },
    },
    {
      name: "partner-proof",
      testMatch: /production-proof\.spec\.ts/,
      grep: /@partner/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: path.join(artifactRoot, "auth/partner.json"),
      },
    },
    {
      name: "internal-proof",
      testMatch: /production-proof\.spec\.ts/,
      grep: /@internal/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: path.join(artifactRoot, "auth/internal.json"),
      },
    },
  ],
});
