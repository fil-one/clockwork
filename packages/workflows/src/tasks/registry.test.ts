import { beforeEach, describe, expect, it, vi } from "vitest";

import { LIFECYCLE_RETRY_POLICY } from "../onboarding/durable";
import { durableRetryPolicy } from "../policy";
import { productionTaskImporters as discoveryImporters } from "../trigger/discovery";
import { defineScheduledTask, defineTask } from "./definition";
import { productionTaskImporters } from "./load";
import {
  listScheduledTasks,
  listTasks,
  registerTask,
  resetTaskRegistryForTests,
} from "./registry";

const noop = () => Promise.resolve(undefined);

/** Every task the application ships, and the scheduled subset of them. */
const PRODUCTION_TASK_COUNT = 48;
const PRODUCTION_SCHEDULED_COUNT = 27;

beforeEach(() => {
  resetTaskRegistryForTests();
});

describe("task registry", () => {
  it("refuses a second task with the same id", () => {
    defineTask({ id: "test.duplicate.v1", run: noop });
    expect(() => defineTask({ id: "test.duplicate.v1", run: noop })).toThrow(
      "TASK_ALREADY_REGISTERED:test.duplicate.v1",
    );
  });

  it("refuses a duplicate registered directly", () => {
    const definition = defineTask({ id: "test.duplicate.v2", run: noop });
    expect(() => registerTask(definition)).toThrow(
      "TASK_ALREADY_REGISTERED:test.duplicate.v2",
    );
  });

  it("lists tasks by id so a manifest has a stable order", () => {
    defineTask({ id: "test.zulu.v1", run: noop });
    defineTask({ id: "test.alpha.v1", run: noop });
    defineScheduledTask({ id: "test.mike.v1", cron: "* * * * *", run: noop });
    expect(listTasks().map((entry) => entry.id)).toEqual([
      "test.alpha.v1",
      "test.mike.v1",
      "test.zulu.v1",
    ]);
  });

  it("lists only the scheduled tasks, each with its cron", () => {
    defineTask({ id: "test.on-demand.v1", run: noop });
    defineScheduledTask({ id: "test.cron.v1", cron: "0 * * * *", run: noop });
    expect(listScheduledTasks().map((entry) => [entry.id, entry.cron])).toEqual(
      [["test.cron.v1", "0 * * * *"]],
    );
  });

  it("re-exports the same importer list discovery drives", () => {
    expect(discoveryImporters).toBe(productionTaskImporters);
  });

  it("registers every production task when the modules load", async () => {
    // A fresh module graph: `runtime/production` imports a task module
    // eagerly, so in this file's own graph that task is already registered
    // and cleared by the reset above, and a cached re-import cannot register
    // it again. Loading into a new registry counts what a host really gets.
    vi.resetModules();
    const [{ loadAllTaskModules }, registry] = await Promise.all([
      import("./load"),
      import("./registry"),
    ]);
    await loadAllTaskModules();
    expect(registry.listTasks()).toHaveLength(PRODUCTION_TASK_COUNT);
    expect(registry.listScheduledTasks()).toHaveLength(
      PRODUCTION_SCHEDULED_COUNT,
    );
    expect(new Set(registry.listTasks().map((entry) => entry.id)).size).toBe(
      PRODUCTION_TASK_COUNT,
    );
  });

  it("keeps the undithered lifecycle retry on lifecycle schedules", async () => {
    vi.resetModules();
    const [{ loadAllTaskModules }, registry] = await Promise.all([
      import("./load"),
      import("./registry"),
    ]);
    await loadAllTaskModules();
    // Lifecycle runs are leased in the database and their backoff is replayed
    // from the attempt number, so the delay has to stay a pure function of it.
    const lifecycleRetry = {
      maxAttempts: LIFECYCLE_RETRY_POLICY.maxAttempts,
      factor: LIFECYCLE_RETRY_POLICY.factor,
      minTimeoutInMs: LIFECYCLE_RETRY_POLICY.minDelayMs,
      maxTimeoutInMs: LIFECYCLE_RETRY_POLICY.maxDelayMs,
      randomize: false,
    };
    const scheduled = registry.listScheduledTasks();
    const lifecycle = scheduled.filter((entry) =>
      entry.id.startsWith("lifecycle-"),
    );
    expect(lifecycle).toHaveLength(15);
    for (const entry of lifecycle) expect(entry.retry).toEqual(lifecycleRetry);
    for (const entry of scheduled.filter(
      (candidate) => !candidate.id.startsWith("lifecycle-"),
    ))
      expect(entry.retry).toEqual(durableRetryPolicy);
  });
});
