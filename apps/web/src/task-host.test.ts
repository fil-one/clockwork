import { describe, expect, it, vi } from "vitest";

import { startTaskHost, type TaskPollerLike } from "./task-host";

interface Harness {
  readonly signals: Map<string, () => void>;
  readonly exits: number[];
  readonly logged: Record<string, unknown>[];
  readonly slept: number[];
}

function harness() {
  const signals = new Map<string, () => void>();
  const exits: number[] = [];
  const logged: Record<string, unknown>[] = [];
  const slept: number[] = [];
  return {
    signals,
    exits,
    logged,
    slept,
    options: {
      onSignal: (signal: string, handler: () => void) =>
        void signals.set(signal, handler),
      exit: (code: number) => void exits.push(code),
      log: (entry: Record<string, unknown>) => void logged.push(entry),
      delay: (ms: number) => {
        slept.push(ms);
        return Promise.resolve();
      },
    },
  } satisfies Harness & { options: unknown };
}

function fakePoller(stop: () => Promise<void> = () => Promise.resolve()) {
  const started: boolean[] = [];
  return {
    started,
    poller: {
      start: () => void started.push(true),
      stop,
    } satisfies TaskPollerLike,
  };
}

const sqsEnv = { NEXT_RUNTIME: "nodejs", CLOCKWORK_TASK_RUNTIME: "sqs" };

describe("task host", () => {
  it("hosts nothing outside the Node runtime", async () => {
    const test = harness();
    const createPoller = vi.fn();

    const host = startTaskHost({
      ...test.options,
      env: { NEXT_RUNTIME: "edge", CLOCKWORK_TASK_RUNTIME: "sqs" },
      createPoller,
    });
    await host.running;

    expect(createPoller).not.toHaveBeenCalled();
    // The Edge runtime has no process to signal; handling one there would
    // claim a shutdown this copy of the module cannot perform.
    expect(test.signals.size).toBe(0);
  });

  it("hosts the poller when the Node server leaves NEXT_RUNTIME unset", async () => {
    // What the standalone container actually provides. `NEXT_RUNTIME` is only
    // a literal the bundler substitutes into Edge-bundled code; the Node
    // server process does not export it, so a host that required it to equal
    // "nodejs" started no poller and installed no signal handler.
    const test = harness();
    const { poller, started } = fakePoller();

    const host = startTaskHost({
      ...test.options,
      env: { CLOCKWORK_TASK_RUNTIME: "sqs" },
      createPoller: () => Promise.resolve(poller),
    });
    await host.running;

    expect(started).toEqual([true]);
    expect(host.poller()).toBe(poller);
    expect(test.signals.has("SIGTERM")).toBe(true);
  });

  it("starts the poller for the queue runtime, however the value is spelled", async () => {
    const test = harness();
    const { poller, started } = fakePoller();

    const host = startTaskHost({
      ...test.options,
      env: { NEXT_RUNTIME: "nodejs", CLOCKWORK_TASK_RUNTIME: " SQS " },
      createPoller: () => Promise.resolve(poller),
    });
    await host.running;

    expect(started).toEqual([true]);
    expect(host.poller()).toBe(poller);
  });

  it("stops a process that hosts no poller as soon as it is signalled", async () => {
    const test = harness();
    const createPoller = vi.fn();

    const host = startTaskHost({
      ...test.options,
      env: { NEXT_RUNTIME: "nodejs", CLOCKWORK_TASK_RUNTIME: "trigger" },
      createPoller,
    });
    await host.running;

    expect(createPoller).not.toHaveBeenCalled();
    // Next's own SIGTERM handler is off (NEXT_MANUAL_SIG_HANDLE), so a
    // Trigger-mode container stops only because this does it.
    expect(test.signals.has("SIGTERM")).toBe(true);
    test.signals.get("SIGTERM")?.();
    await vi.waitUntil(() => test.exits.length === 1);
    expect(test.exits).toEqual([0]);
  });

  it("retries a failed start with a backoff capped at a minute", async () => {
    const test = harness();
    const { poller, started } = fakePoller();
    let attempts = 0;
    const createPoller = () => {
      attempts += 1;
      if (attempts <= 8)
        return Promise.reject(
          new Error(`ECONNREFUSED ${"detail ".repeat(60)}`),
        );
      return Promise.resolve(poller);
    };

    const host = startTaskHost({ ...test.options, env: sqsEnv, createPoller });
    await host.running;

    expect(started).toEqual([true]);
    expect(test.slept).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000,
    ]);
    // Every attempt is reported, and the report is bounded.
    const failures = test.logged.filter(
      (entry) => entry.event === "TASK_POLLER_START_FAILED",
    );
    expect(failures).toHaveLength(8);
    expect(failures[0]).toMatchObject({ name: "Error", attempt: 1 });
    expect(String(failures[0]?.message)).toHaveLength(200);
  });

  it("drains the runs in flight before it exits", async () => {
    const test = harness();
    let release!: () => void;
    const drained = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { poller } = fakePoller(() => drained);

    const host = startTaskHost({
      ...test.options,
      env: sqsEnv,
      createPoller: () => Promise.resolve(poller),
    });
    await host.running;

    test.signals.get("SIGTERM")?.();
    await Promise.resolve();
    // A run that has charged a customer but not recorded it must land before
    // the process goes; the message would otherwise return after its lease.
    expect(test.exits).toEqual([]);
    release();
    await vi.waitUntil(() => test.exits.length === 1);
    expect(test.exits).toEqual([0]);
  });

  it("exits on the deadline when a run will not finish", async () => {
    const test = harness();
    const { poller } = fakePoller(() => new Promise<void>(() => {}));

    const host = startTaskHost({
      ...test.options,
      env: sqsEnv,
      createPoller: () => Promise.resolve(poller),
      drainTimeoutMs: 100_000,
    });
    await host.running;

    test.signals.get("SIGTERM")?.();
    await vi.waitUntil(() => test.exits.length === 1);
    // ECS kills the container at its stop timeout either way; exiting first
    // keeps the deadline ours and the last log line ours.
    expect(test.slept).toContain(100_000);
    expect(test.logged).toContainEqual(
      expect.objectContaining({ event: "TASK_DRAIN_TIMEOUT" }),
    );
    expect(test.exits).toEqual([0]);
  });

  it("stops retrying once it has been signalled", async () => {
    const test = harness();
    let attempts = 0;
    const createPoller = () => {
      attempts += 1;
      test.signals.get("SIGTERM")?.();
      return Promise.reject(new Error("DATABASE_UNREACHABLE"));
    };

    const host = startTaskHost({ ...test.options, env: sqsEnv, createPoller });
    await host.running;

    expect(attempts).toBe(1);
    expect(test.exits).toEqual([0]);
  });
});
