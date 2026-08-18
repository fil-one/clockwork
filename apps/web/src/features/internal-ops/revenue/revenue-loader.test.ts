import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadRevenueWorkspace } from "./revenue-loader";

const previous = process.env.CLOCKWORK_SERVICE_DATABASE_URL;
beforeEach(() => delete process.env.CLOCKWORK_SERVICE_DATABASE_URL);
afterEach(() => {
  vi.unstubAllEnvs();
  if (previous === undefined) delete process.env.CLOCKWORK_SERVICE_DATABASE_URL;
  else process.env.CLOCKWORK_SERVICE_DATABASE_URL = previous;
});

function enableExplicitDemo(): void {
  vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
  vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
  vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("CLOCKWORK_ENV", "");
  vi.stubEnv("DEPLOYMENT_ENVIRONMENT", "");
  vi.stubEnv("ENVIRONMENT", "");
}

describe("revenue workspace without a service connection", () => {
  it("reports unreadable instead of returning a zero-revenue report", async () => {
    await expect(
      loadRevenueWorkspace({ requestId: "revenue-unwired" }),
    ).resolves.toMatchObject({
      readable: false,
      stages: [],
      recurring: [],
      source: "No revenue reporting read is available",
    });
  });

  it("serves a labeled reporting ledger only for the canonical demo identity", async () => {
    enableExplicitDemo();

    await expect(
      loadRevenueWorkspace({ requestId: "revenue-demo" }),
    ).resolves.toMatchObject({
      readable: true,
      forecastRowCount: 13,
      remainingBacklogRowCount: 5,
      recurringContractCount: 1,
      source: "Demonstration commerce reporting ledger",
      stages: [
        {
          stage: "committed_backlog",
          currency: "USD",
          revenueBasis: "gross",
          revenueMinor: "18480000",
        },
        {
          stage: "pipeline",
          currency: "USD",
          revenueBasis: "gross",
          revenueMinor: "18480000",
        },
      ],
    });
  });

  it.each([
    ["CLOCKWORK_DEMO_DEPLOY", ""],
    ["CLOCKWORK_EXPERIENCE_ADAPTER", "database"],
    ["NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "production"],
    ["VERCEL_ENV", "production"],
  ])("keeps the demo ledger closed when %s drifts", async (key, value) => {
    enableExplicitDemo();
    vi.stubEnv(key, value);

    await expect(
      loadRevenueWorkspace({ requestId: `revenue-drift:${key}` }),
    ).resolves.toMatchObject({
      readable: false,
      source: "No revenue reporting read is available",
    });
  });
});
