import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";
import { createPristineDemoAdapterState } from "@clockwork/testing/demo-state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

let store = createMemoryDemoStore();

vi.mock("@/src/features/experience-server/demo-state-store", () => ({
  configuredDemoStateStore: () => store,
}));

function reset(): Promise<Response> {
  return POST(
    new Request("https://demo.clockwork.test/api/demo/reset", {
      method: "POST",
    }),
  );
}

beforeEach(() => {
  store = createMemoryDemoStore();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("demo reset route", () => {
  it("does not exist without the demo deploy opt-in", async () => {
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "");

    const response = await reset();

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("");
  });

  it("restores the seeded fixtures under the opt-in", async () => {
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
    vi.stubEnv("NODE_ENV", "production");
    await store.update((current) => ({ ...current, revision: 7 }));

    const response = await reset();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      target: "demo",
      statePath: "memory",
    });
    await expect(store.read()).resolves.toEqual(
      createPristineDemoAdapterState(),
    );
  });

  it("refuses when a platform marker reports production", async () => {
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
    vi.stubEnv("DEPLOYMENT_ENVIRONMENT", "production");
    await store.update((current) => ({ ...current, revision: 7 }));

    const response = await reset();

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    await expect(response.json()).resolves.toMatchObject({
      code: "DEMO_RESET_BLOCKED",
    });
    await expect(store.read()).resolves.toMatchObject({ revision: 7 });
  });
});
