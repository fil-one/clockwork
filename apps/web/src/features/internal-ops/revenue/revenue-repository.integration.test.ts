import { afterAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "@clockwork/db";

import { readRevenueWorkspace } from "./revenue-repository";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 1,
  role: "clockwork_service",
  ssl: false,
});

afterAll(() => client.end());

describe("revenue workspace reporting views", () => {
  it("drives both live report relations without merging currency or basis", async () => {
    const workspace = await readRevenueWorkspace(db, {
      requestId: `revenue-view-integration:${crypto.randomUUID()}`,
    });
    expect(workspace.readable).toBe(true);
    expect(workspace.forecastRowCount).toBeGreaterThan(0);
    expect(
      workspace.stages.some((row) => row.stage === "committed_backlog"),
    ).toBe(true);
    expect(
      workspace.stages.every((row) => row.currency && row.revenueBasis),
    ).toBe(true);
    expect(
      workspace.recurring.every(
        (row) => row.currency && row.revenueBasis && row.methodologyVersion,
      ),
    ).toBe(true);
  });
});
