import path from "node:path";

import { defineConfig } from "@playwright/test";

const configured = process.env.CLOCKWORK_HOSTED_DEMO_URL;
if (!configured)
  throw new Error("CLOCKWORK_HOSTED_DEMO_URL is required for hosted demo QA.");
const target = new URL(configured);
if (
  target.protocol !== "https:" ||
  target.port ||
  target.username ||
  target.password ||
  target.pathname !== "/" ||
  target.search ||
  target.hash ||
  !/^(?:[a-f0-9]+--)?clockwork-commerce-demo\.netlify\.app$/.test(
    target.hostname,
  )
)
  throw new Error("Hosted demo QA requires the Clockwork Netlify demo origin.");
if (!process.env.CLOCKWORK_DEMO_ACCESS_PASSWORD)
  throw new Error(
    "CLOCKWORK_DEMO_ACCESS_PASSWORD is required for hosted demo QA.",
  );

const artifactRoot = path.resolve(
  process.env.CLOCKWORK_ARTIFACT_DIR ?? "test-results/hosted-demo",
);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "demo.spec.ts",
  // The visual baselines were reviewed on the pinned macOS runner against the
  // release shard's fixture state, and this site serves shared demo state that
  // anyone with the password can have changed. Hosted qualification therefore
  // takes every transaction journey and its a11y checks, and leaves the
  // screenshots to the release shard.
  grepInvert: /visual demo/,
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: path.join(artifactRoot, "playwright-output"),
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(artifactRoot, "playwright.json") }],
  ],
  use: {
    baseURL: target.origin,
    browserName: "chromium",
    // The hosted password is a real secret. Do not retain authentication traces.
    trace: "off",
  },
});
