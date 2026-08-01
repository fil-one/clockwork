import { describe, expect, it } from "vitest";

import {
  assertDemoResetAllowed,
  createMemoryDemoStore,
  DEMO_RESET_COMMAND,
  DemoResetBlockedError,
  resetDemoExperience,
} from "./reset";
import { createDemoSeed, DEMO_NOW } from "./seed";
import {
  createPristineDemoAdapterState,
  DemoStateCorruptError,
  type DemoAdapterState,
} from "./state";

describe("demo reset", () => {
  it("restores the same fixed-clock state after arbitrary fixture mutation", async () => {
    const clean = createPristineDemoAdapterState();
    const dirty: DemoAdapterState = {
      ...clean,
      revision: 3,
      projectionOverrides: {
        "50000000-0000-4000-8000-000000000001": {
          version: 4,
          updatedAt: "2026-08-01T12:00:00Z",
          data: { title: "Locally changed title" },
        },
      },
    };
    const store = createMemoryDemoStore(dirty);

    const result = await resetDemoExperience(store, {
      environment: { NODE_ENV: "test" },
      target: "demo",
    });

    expect(await store.read()).toEqual(createPristineDemoAdapterState());
    expect(result.resetAt).toBe(DEMO_NOW);
    expect(result.statePath).toBe("memory");
    expect(result.counts.quotes).toBe(createDemoSeed().quotes.length);
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

  it("validates in-memory updates through the canonical state parser", async () => {
    const pristine = createPristineDemoAdapterState();
    const store = createMemoryDemoStore(pristine);

    await expect(
      store.update((current) => ({ ...current, revision: -1 })),
    ).rejects.toThrow(DemoStateCorruptError);
    expect(await store.read()).toEqual(pristine);
  });

  it("publishes one copy-and-run reset command", () => {
    expect(DEMO_RESET_COMMAND).toBe(
      "pnpm exec tsx packages/testing/src/demo/reset-command.ts",
    );
  });
});
