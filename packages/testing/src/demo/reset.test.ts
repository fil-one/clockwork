import { describe, expect, it } from "vitest";

import {
  assertDemoResetAllowed,
  createMemoryDemoStore,
  DEMO_RESET_COMMAND,
  DemoResetBlockedError,
  resetDemoExperience,
} from "./reset";
import {
  createDemoSeed,
  DEMO_NOW,
  type DemoSeed,
  pristineDemoSeed,
} from "./seed";

describe("demo reset", () => {
  it("restores the same fixed-clock state after arbitrary fixture mutation", async () => {
    const clean = createDemoSeed();
    const firstAccount = clean.accounts.at(0);
    if (!firstAccount) throw new Error("demo seed must include an account");
    const dirty: DemoSeed = {
      ...clean,
      accounts: [{ ...firstAccount, name: "Locally changed name" }],
      quotes: [],
    };
    const store = createMemoryDemoStore(dirty);

    const result = await resetDemoExperience(store, {
      environment: { NODE_ENV: "test" },
      target: "demo",
    });

    expect(await store.read()).toEqual(pristineDemoSeed);
    expect(result.resetAt).toBe(DEMO_NOW);
    expect(result.counts.quotes).toBe(pristineDemoSeed.quotes.length);
  });

  it.each([
    "NODE_ENV",
    "VERCEL_ENV",
    "CLOCKWORK_ENV",
    "DEPLOYMENT_ENVIRONMENT",
    "ENVIRONMENT",
  ])("cannot be forced past the %s production marker", (key) => {
    expect(() =>
      assertDemoResetAllowed(
        { NODE_ENV: "development", [key]: "production" },
        "demo",
      ),
    ).toThrow(DemoResetBlockedError);
  });

  it("refuses every target other than the explicit demo target", () => {
    expect(() =>
      assertDemoResetAllowed({ NODE_ENV: "test" }, "staging"),
    ).toThrow('target must be exactly "demo"');
  });

  it("publishes one copy-and-run reset command without a manifest change", () => {
    expect(DEMO_RESET_COMMAND).toBe(
      "pnpm exec tsx packages/testing/src/demo/reset-command.ts",
    );
  });
});
