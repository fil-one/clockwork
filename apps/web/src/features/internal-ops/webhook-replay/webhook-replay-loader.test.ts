import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOptionalServiceDatabase: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/src/db/service", () => ({
  getOptionalServiceDatabase: mocks.getOptionalServiceDatabase,
}));
vi.mock("@clockwork/db", () => ({
  DatabaseWebhookReplayReadModel: class {
    public list = mocks.list;
  },
}));

import { loadReplayableWebhookEvents } from "./webhook-replay-loader";

const event = {
  id: "70000000-0000-4000-8000-000000000001",
  provider: "stripe",
  providerEventId: "evt_1J4k",
  eventType: "invoice.payment_failed",
  payloadHash: "sha256:9f2c",
  occurredAt: "2026-07-30T11:04:00.000Z",
  signatureVerifiedAt: "2026-07-30T11:04:01.000Z",
  attemptCount: 3,
  processedAt: null,
  processingError: "handler timeout",
  state: "failed" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOptionalServiceDatabase.mockReturnValue({});
  mocks.list.mockResolvedValue([event]);
});

describe("replayable webhook event queue", () => {
  it("reads the stopped callbacks for the request", async () => {
    const queue = await loadReplayableWebhookEvents({
      requestId: "experience:webhook-replay:test",
    });

    expect(queue).toEqual({
      events: [event],
      source: "Verified provider callbacks",
      readable: true,
    });
    expect(mocks.list).toHaveBeenCalledWith({
      requestId: "experience:webhook-replay:test",
      limit: 100,
    });
  });

  it("passes a provider filter only when one is given", async () => {
    await loadReplayableWebhookEvents({
      requestId: "experience:webhook-replay:test",
      provider: "stripe",
      limit: 10,
    });

    expect(mocks.list).toHaveBeenCalledWith({
      requestId: "experience:webhook-replay:test",
      limit: 10,
      provider: "stripe",
    });
  });

  it("reports an unconfigured database as unreadable rather than empty", async () => {
    mocks.getOptionalServiceDatabase.mockReturnValue(undefined);

    const queue = await loadReplayableWebhookEvents({
      requestId: "experience:webhook-replay:test",
    });

    // No stopped callbacks and no way to see them lead an operator to opposite
    // conclusions, so the page must be able to tell them apart.
    expect(queue.readable).toBe(false);
    expect(queue.events).toEqual([]);
    expect(queue.source).toBe("No callback read is available");
  });

  it("reports a failed read as unreadable", async () => {
    mocks.list.mockRejectedValue(new Error("connection refused"));

    const queue = await loadReplayableWebhookEvents({
      requestId: "experience:webhook-replay:test",
    });

    expect(queue.readable).toBe(false);
    expect(queue.events).toEqual([]);
  });
});
