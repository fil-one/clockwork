import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadOperationalQueueStatus } from "./status-loader";

const previous = process.env.CLOCKWORK_SERVICE_DATABASE_URL;
beforeEach(() => delete process.env.CLOCKWORK_SERVICE_DATABASE_URL);
afterEach(() => {
  if (previous === undefined) delete process.env.CLOCKWORK_SERVICE_DATABASE_URL;
  else process.env.CLOCKWORK_SERVICE_DATABASE_URL = previous;
});

describe("integration queue status without a service database", () => {
  it("marks both reads unavailable instead of treating the queues as empty", async () => {
    await expect(
      loadOperationalQueueStatus({ requestId: "status-page-unwired" }),
    ).resolves.toEqual({
      dispatch: 0,
      provisioning: 0,
      workflow: 0,
      webhook: 0,
      deadLettersReadable: false,
      webhooksReadable: false,
    });
  });
});
