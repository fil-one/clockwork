import { describe, expect, it, vi } from "vitest";

import { DEMO_PRODUCTION_ENVIRONMENT_KEYS } from "@clockwork/testing/demo-state";

vi.mock("@/src/auth/session", () => ({ getCommerceSession: vi.fn() }));
vi.mock("./projection-source", () => ({
  configuredProjectionSource: vi.fn(),
  projectionInput: vi.fn(),
}));

import { explicitDashboardDemoEnabled } from "./dashboard-loader";

describe("dashboard demo boundary", () => {
  it.each(DEMO_PRODUCTION_ENVIRONMENT_KEYS)(
    "rejects static demo projections when %s marks production",
    (productionKey) => {
      const environment: Record<string, string | undefined> = {
        NODE_ENV: "test",
        NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV: "local",
        CLOCKWORK_EXPERIENCE_ADAPTER: "demo",
      };
      environment[productionKey] = " Production ";

      expect(explicitDashboardDemoEnabled(environment)).toBe(false);
    },
  );

  it("rejects the public production marker and permits an explicit local demo", () => {
    expect(
      explicitDashboardDemoEnabled({
        NODE_ENV: "test",
        NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV: "production",
        CLOCKWORK_EXPERIENCE_ADAPTER: "demo",
      }),
    ).toBe(false);
    expect(
      explicitDashboardDemoEnabled({
        NODE_ENV: "test",
        NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV: "local",
        CLOCKWORK_EXPERIENCE_ADAPTER: "demo",
      }),
    ).toBe(true);
  });
});
