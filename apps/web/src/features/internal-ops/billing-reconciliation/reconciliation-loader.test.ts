import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadReconciliationWorkspace } from "./reconciliation-loader";

const previous = process.env.CLOCKWORK_SERVICE_DATABASE_URL;

beforeEach(() => {
  delete process.env.CLOCKWORK_SERVICE_DATABASE_URL;
});

afterEach(() => {
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
});
