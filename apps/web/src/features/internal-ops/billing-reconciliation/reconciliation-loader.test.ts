import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadReconciliationWorkspace } from "./reconciliation-loader";

const previous = process.env.CLOCKWORK_SERVICE_DATABASE_URL;

beforeEach(() => {
  delete process.env.CLOCKWORK_SERVICE_DATABASE_URL;
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (previous === undefined) delete process.env.CLOCKWORK_SERVICE_DATABASE_URL;
  else process.env.CLOCKWORK_SERVICE_DATABASE_URL = previous;
});

/**
 * A finance surface that renders an empty close when it could not read is the
 * one failure that gets signed. With no connection it says so.
 */
describe("no service connection", () => {
  it("reports that the close is unreadable and invents no periods", async () => {
    const workspace = await loadReconciliationWorkspace({
      requestId: "billing-reconciliation-unwired",
    });
    expect(workspace.readable).toBe(false);
    expect(workspace.periods).toEqual([]);
    expect(workspace.variances).toEqual([]);
    expect(workspace.source).toBe("No reconciliation read is available");
  });

  it("uses the resettable ledger only for the exact demo identity", async () => {
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("CLOCKWORK_ENV", "");
    vi.stubEnv("DEPLOYMENT_ENVIRONMENT", "");
    vi.stubEnv("ENVIRONMENT", "");

    await expect(
      loadReconciliationWorkspace({ requestId: "reconciliation-demo" }),
    ).resolves.toMatchObject({
      readable: true,
      source: "Demonstration tie-out and reconciliation ledger",
      periods: [{ mathematicallyTied: false }],
      variances: [{ objectId: "INV-2026-0781" }],
    });
  });
});
