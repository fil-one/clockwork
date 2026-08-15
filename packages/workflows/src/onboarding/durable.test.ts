import { describe, expect, it } from "vitest";

import {
  disposeEffectFailure,
  jitteredRetryDelayMs,
  retryDelayMs,
} from "./durable";

const identity = {
  aggregateType: "order",
  aggregateId: "order-1",
  aggregateVersion: 1,
  operation: "provision",
};

function scheduled(attempt: number, jitter: () => number) {
  const disposition = disposeEffectFailure({
    identity,
    effectDiscriminator: "command",
    attempt,
    failure: { kind: "transient", code: "TIMEOUT", message: "try again" },
    failedAt: "2026-07-31T16:00:00.000Z",
    jitter,
  });
  if (disposition.status !== "retry_scheduled")
    throw new Error("Expected a scheduled retry");
  return (
    Date.parse(disposition.nextAttemptAt) -
    Date.parse("2026-07-31T16:00:00.000Z")
  );
}

describe("lifecycle retry jitter", () => {
  it("spreads the computed backoff over the upper half of the interval", () => {
    for (const attempt of [1, 2, 5, 9]) {
      const base = retryDelayMs(attempt);
      expect(jitteredRetryDelayMs(attempt, () => 0)).toBe(
        base - Math.floor(base / 2),
      );
      expect(jitteredRetryDelayMs(attempt, () => 1)).toBe(base);
      expect(jitteredRetryDelayMs(attempt, () => 0.5)).toBeGreaterThan(
        base - Math.floor(base / 2),
      );
      expect(jitteredRetryDelayMs(attempt, () => 0.5)).toBeLessThan(base);
    }
  });

  it("rejects a source that is not a uniform sample", () => {
    expect(() => jitteredRetryDelayMs(2, () => 1.5)).toThrow(
      "RETRY_JITTER_SAMPLE_INVALID",
    );
    expect(() => jitteredRetryDelayMs(2, () => -0.1)).toThrow(
      "RETRY_JITTER_SAMPLE_INVALID",
    );
    expect(() => jitteredRetryDelayMs(2, () => Number.NaN)).toThrow(
      "RETRY_JITTER_SAMPLE_INVALID",
    );
  });

  it("does not schedule two runs that failed together onto the same instant", () => {
    // The failure this closes: with no jitter every one of these is 2_000.
    const samples = [0, 0.25, 0.5, 0.75, 1];
    const delays = samples.map((sample) => scheduled(2, () => sample));
    expect(new Set(delays).size).toBe(samples.length);
    expect(Math.min(...delays)).toBe(1_000);
    expect(Math.max(...delays)).toBe(2_000);
  });

  it("leaves a provider-supplied retry-after undithered", () => {
    const disposition = disposeEffectFailure({
      identity,
      effectDiscriminator: "command",
      attempt: 2,
      failure: {
        kind: "transient",
        code: "RATE_LIMITED",
        message: "slow down",
        retryAfterMs: 45_000,
      },
      failedAt: "2026-07-31T16:00:00.000Z",
      jitter: () => 0,
    });
    expect(disposition).toMatchObject({
      status: "retry_scheduled",
      nextAttemptAt: "2026-07-31T16:00:45.000Z",
    });
  });

  it("defaults to a real source so production never retries in lockstep", () => {
    const delays = new Set(
      Array.from({ length: 200 }, () =>
        disposeEffectFailure({
          identity,
          effectDiscriminator: "command",
          attempt: 7,
          failure: { kind: "transient", code: "TIMEOUT", message: "retry" },
          failedAt: "2026-07-31T16:00:00.000Z",
        }),
      ).map((disposition) =>
        disposition.status === "retry_scheduled"
          ? disposition.nextAttemptAt
          : "dead",
      ),
    );
    expect(delays.size).toBeGreaterThan(1);
  });
});
