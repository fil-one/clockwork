import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadRevenueWorkspace } from "./revenue-loader";

const previous = process.env.CLOCKWORK_SERVICE_DATABASE_URL;
beforeEach(() => delete process.env.CLOCKWORK_SERVICE_DATABASE_URL);
afterEach(() => {
  if (previous === undefined) delete process.env.CLOCKWORK_SERVICE_DATABASE_URL;
  else process.env.CLOCKWORK_SERVICE_DATABASE_URL = previous;
});

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
});
