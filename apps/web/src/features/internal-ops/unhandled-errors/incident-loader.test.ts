import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOptionalServiceDatabase: vi.fn(),
  read: vi.fn(),
}));

vi.mock("@/src/db/service", () => ({
  getOptionalServiceDatabase: mocks.getOptionalServiceDatabase,
}));

import type * as IncidentRepository from "./incident-repository";
import {
  unreadableIncidentQueue,
  unwiredIncidentQueue,
} from "./incident-repository";
import { loadRuntimeFailureIncidents } from "./incident-loader";

const previous = process.env.CLOCKWORK_SERVICE_DATABASE_URL;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  delete process.env.CLOCKWORK_SERVICE_DATABASE_URL;
  mocks.getOptionalServiceDatabase.mockReturnValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("./incident-repository");
  if (previous === undefined) delete process.env.CLOCKWORK_SERVICE_DATABASE_URL;
  else process.env.CLOCKWORK_SERVICE_DATABASE_URL = previous;
});

/**
 * The one property the loader has that no integration test can show: it never
 * returns an empty list for a read that did not happen, and it distinguishes
 * the two ways a read does not happen. Collapsing them told an operator whose
 * query was broken to go and check the connection string.
 */
describe("when nothing was read", () => {
  it("reports an absent connection as an absent connection", async () => {
    const queue = await loadRuntimeFailureIncidents({
      requestId: "unhandled-errors-unwired",
    });
    expect(queue).toEqual(unwiredIncidentQueue);
    expect(queue.readable).toBe(false);
    expect(queue.state).toBe("no_connection");
    expect(queue.incidents).toEqual([]);
    expect(queue.source).toBe("No service connection is configured");
  });

  it("reads the resettable incident ledger in the exact demo", async () => {
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("CLOCKWORK_ENV", "");
    vi.stubEnv("DEPLOYMENT_ENVIRONMENT", "");
    vi.stubEnv("ENVIRONMENT", "");

    await expect(
      loadRuntimeFailureIncidents({ requestId: "unhandled-errors-demo" }),
    ).resolves.toMatchObject({
      readable: true,
      state: "read",
      source: "Demonstration runtime failure ledger",
      incidents: [
        {
          eventType: "lifecycle.provider_effect.dead_lettered",
          safeCode: "PROVIDER_TIMEOUT",
        },
      ],
    });
  });

  it("reports a read that raised as a failed read, not as a missing connection", async () => {
    vi.resetModules();
    vi.doMock("./incident-repository", async () => {
      const actual = await vi.importActual<typeof IncidentRepository>(
        "./incident-repository",
      );
      return {
        ...actual,
        readRuntimeFailureIncidents: mocks.read,
      };
    });
    mocks.getOptionalServiceDatabase.mockReturnValue({});
    mocks.read.mockRejectedValue(
      new Error('relation "audit_events" does not exist'),
    );

    const { loadRuntimeFailureIncidents: load } =
      await import("./incident-loader");
    const queue = await load({ requestId: "unhandled-errors-broken-read" });

    expect(queue.readable).toBe(false);
    expect(queue.state).toBe("read_failed");
    expect(queue.incidents).toEqual([]);
    expect(queue.source).toBe(unreadableIncidentQueue.source);
    // The exception's own text never reaches the caller: step 1 of the runbook
    // forbids putting it anywhere it can be read off a screen.
    expect(JSON.stringify(queue)).not.toContain("audit_events");
  });
});
