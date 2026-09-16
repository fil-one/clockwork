import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { defineScheduledTask, defineTask } from "./definition";
import { resetTaskRegistryForTests } from "./registry";
import { registerAllTriggerTasks, toTriggerTask } from "./trigger-adapter";

interface CapturedTask {
  id: string;
  retry: Record<string, unknown>;
  run: (payload: unknown, meta: { ctx: TriggerContext }) => Promise<unknown>;
}

interface CapturedSchedule extends CapturedTask {
  cron: { pattern: string; timezone: string; environments?: string[] };
  ttl?: string;
}

interface TriggerContext {
  run: { id: string };
  attempt: { number: number };
}

const capturedTasks: CapturedTask[] = [];
const capturedSchedules: CapturedSchedule[] = [];

vi.mock("@trigger.dev/sdk", () => ({
  task: (definition: CapturedTask) => {
    capturedTasks.push(definition);
    return { id: definition.id };
  },
  schedules: {
    task: (definition: CapturedSchedule) => {
      capturedSchedules.push(definition);
      return { id: definition.id };
    },
  },
  idempotencyKeys: { create: (key: string) => Promise.resolve(key) },
  tasks: { trigger: () => Promise.resolve({ id: "run_stub" }) },
}));

const ctx: TriggerContext = { run: { id: "run_abc" }, attempt: { number: 3 } };

describe("toTriggerTask", () => {
  beforeEach(() => {
    capturedTasks.length = 0;
    capturedSchedules.length = 0;
    resetTaskRegistryForTests();
  });

  it("flattens the Trigger context onto an on-demand run", async () => {
    const seen: unknown[] = [];
    toTriggerTask(
      defineTask({
        id: "test.on-demand.v1",
        run: (payload, taskCtx) => {
          seen.push(payload, taskCtx);
          return Promise.resolve("ok");
        },
      }),
    );
    const captured = capturedTasks[0];
    expect(captured?.id).toBe("test.on-demand.v1");
    await expect(captured?.run({ order: 7 }, { ctx })).resolves.toBe("ok");
    expect(seen).toEqual([{ order: 7 }, { runId: "run_abc", attempt: 3 }]);
  });

  it("parses the payload before the task sees it", async () => {
    toTriggerTask(
      defineTask({
        id: "test.schema.v1",
        schema: {
          parse: (raw: unknown) => {
            if (typeof raw !== "string") throw new Error("NOT_A_STRING");
            return raw;
          },
        },
        run: noop,
      }),
    );
    await expect(capturedTasks[0]?.run(9, { ctx })).rejects.toThrow(
      "NOT_A_STRING",
    );
  });

  it("carries the retry policy through unchanged", () => {
    const retry = {
      maxAttempts: 4,
      factor: 3,
      minTimeoutInMs: 20,
      maxTimeoutInMs: 200,
      randomize: false,
    };
    toTriggerTask(defineTask({ id: "test.retry.v1", retry, run: noop }));
    expect(capturedTasks[0]?.retry).toEqual(retry);
  });

  it("turns the schedule occurrence into a scheduledAt payload and context", async () => {
    const seen: unknown[] = [];
    toTriggerTask(
      defineScheduledTask({
        id: "test.schedule.v1",
        cron: "15 * * * *",
        run: (payload, taskCtx) => {
          seen.push(payload, taskCtx);
          return Promise.resolve("ok");
        },
      }),
    );
    const captured = capturedSchedules[0];
    expect(captured?.cron).toEqual({ pattern: "15 * * * *", timezone: "UTC" });
    await expect(
      captured?.run(
        { timestamp: new Date("2026-03-04T05:06:07.000Z") },
        { ctx },
      ),
    ).resolves.toBe("ok");
    expect(seen).toEqual([
      { scheduledAt: "2026-03-04T05:06:07.000Z" },
      {
        runId: "run_abc",
        attempt: 3,
        scheduledAt: "2026-03-04T05:06:07.000Z",
      },
    ]);
  });

  it("names Trigger environments only for a staged schedule", () => {
    toTriggerTask(
      defineScheduledTask({
        id: "test.everywhere.v1",
        cron: "* * * * *",
        run: noop,
      }),
    );
    toTriggerTask(
      defineScheduledTask({
        id: "test.staged.v1",
        cron: "* * * * *",
        stages: ["staging", "production"],
        run: noop,
      }),
    );
    expect(capturedSchedules[0]?.cron).not.toHaveProperty("environments");
    expect(capturedSchedules[1]?.cron.environments).toEqual([
      "STAGING",
      "PRODUCTION",
    ]);
  });

  it("sets a ttl only when the task drops stale deliveries", () => {
    toTriggerTask(
      defineScheduledTask({
        id: "test.no-ttl.v1",
        cron: "* * * * *",
        run: noop,
      }),
    );
    toTriggerTask(
      defineScheduledTask({
        id: "test.ttl.v1",
        cron: "* * * * *",
        deliveryTtlMs: 60_000,
        run: noop,
      }),
    );
    expect(capturedSchedules[0]).not.toHaveProperty("ttl");
    expect(capturedSchedules[1]?.ttl).toBe("1m");
  });
});

/**
 * Importing a task module registers its tasks, and the module cache makes that
 * a one-time effect: these assertions share the single registration rather
 * than clearing a registry no reload would refill.
 */
describe("registerAllTriggerTasks", () => {
  beforeAll(async () => {
    resetTaskRegistryForTests();
    capturedTasks.length = 0;
    capturedSchedules.length = 0;
    await registerAllTriggerTasks();
  });

  it("hands every production task to the Trigger SDK", () => {
    expect(capturedTasks.length + capturedSchedules.length).toBe(48);
    expect(capturedSchedules).toHaveLength(27);
  });

  it("stages every application schedule and expires only the outbox dispatcher", () => {
    const withTtl = capturedSchedules.filter((entry) => "ttl" in entry);
    expect(withTtl.map((entry) => [entry.id, entry.ttl])).toEqual([
      ["system.outbox.dispatch.v1", "1m"],
    ]);
    expect(
      capturedSchedules
        .filter((entry) => entry.cron.environments)
        .map((entry) => entry.id),
    ).toContain("system.outbox.dispatch.v1");
  });
});

function noop(): Promise<unknown> {
  return Promise.resolve(undefined);
}
