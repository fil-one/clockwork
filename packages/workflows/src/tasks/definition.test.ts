import { beforeEach, describe, expect, it } from "vitest";

import { durableRetryPolicy } from "../policy";
import { defineScheduledTask, defineTask } from "./definition";
import { getTask, resetTaskRegistryForTests } from "./registry";

const noop = () => Promise.resolve(undefined);

beforeEach(() => {
  resetTaskRegistryForTests();
});

describe("defineTask", () => {
  it("registers an on-demand task under its id", () => {
    const definition = defineTask({ id: "test.on-demand.v1", run: noop });
    expect(definition.kind).toBe("on_demand");
    expect(getTask("test.on-demand.v1")).toBe(definition);
  });

  it("falls back to the durable retry policy", () => {
    const definition = defineTask({ id: "test.retry.v1", run: noop });
    expect(definition.retry).toEqual(durableRetryPolicy);
  });

  it("keeps an explicit retry policy", () => {
    const retry = {
      maxAttempts: 3,
      factor: 1.5,
      minTimeoutInMs: 10,
      maxTimeoutInMs: 100,
      randomize: false,
    };
    expect(defineTask({ id: "test.retry.v2", retry, run: noop }).retry).toEqual(
      retry,
    );
  });

  it("passes the payload through untouched without a schema", () => {
    const payload = { anything: true };
    expect(
      defineTask({ id: "test.parse.v1", run: noop }).parse(payload),
    ).toEqual(payload);
  });

  it("parses through the supplied schema", () => {
    const definition = defineTask({
      id: "test.parse.v2",
      schema: {
        parse: (raw: unknown) => {
          if (typeof raw !== "string") throw new Error("NOT_A_STRING");
          return raw;
        },
      },
      run: noop,
    });
    expect(definition.parse("ok")).toBe("ok");
    expect(() => definition.parse(7)).toThrow("NOT_A_STRING");
  });

  it("hands the run function the payload and the context", async () => {
    const seen: unknown[] = [];
    const definition = defineTask({
      id: "test.run.v1",
      run: (payload, ctx) => {
        seen.push(payload, ctx);
        return Promise.resolve("done");
      },
    });
    await expect(
      definition.run({ id: 1 }, { runId: "run_1", attempt: 2 }),
    ).resolves.toBe("done");
    expect(seen).toEqual([{ id: 1 }, { runId: "run_1", attempt: 2 }]);
  });
});

describe("defineScheduledTask", () => {
  it("registers a scheduled task with its cron", () => {
    const definition = defineScheduledTask({
      id: "test.schedule.v1",
      cron: "*/5 * * * *",
      run: noop,
    });
    expect(definition.kind).toBe("scheduled");
    expect(definition.cron).toBe("*/5 * * * *");
    expect(getTask("test.schedule.v1")).toBe(definition);
  });

  it("carries stages and a delivery ttl only when they are given", () => {
    const bare = defineScheduledTask({
      id: "test.schedule.v2",
      cron: "* * * * *",
      run: noop,
    });
    expect(bare.stages).toBeUndefined();
    expect(bare.deliveryTtlMs).toBeUndefined();

    const staged = defineScheduledTask({
      id: "test.schedule.v3",
      cron: "* * * * *",
      stages: ["staging", "production"],
      deliveryTtlMs: 60_000,
      run: noop,
    });
    expect(staged.stages).toEqual(["staging", "production"]);
    expect(staged.deliveryTtlMs).toBe(60_000);
  });

  it("requires the occurrence time on the payload", () => {
    const definition = defineScheduledTask({
      id: "test.schedule.v4",
      cron: "* * * * *",
      run: noop,
    });
    expect(
      definition.parse({ scheduledAt: "2026-01-01T00:00:00.000Z" }),
    ).toEqual({ scheduledAt: "2026-01-01T00:00:00.000Z" });
    expect(() => definition.parse({})).toThrow();
  });

  it("guarantees scheduledAt on the context even when the runtime omits it", async () => {
    let seen: { scheduledAt: string } | undefined;
    const definition = defineScheduledTask({
      id: "test.schedule.v5",
      cron: "* * * * *",
      run: (_payload, ctx) => {
        seen = { scheduledAt: ctx.scheduledAt };
        return Promise.resolve(undefined);
      },
    });
    await definition.run(
      { scheduledAt: "2026-02-02T03:04:05.000Z" },
      { runId: "run_2", attempt: 1 },
    );
    expect(seen).toEqual({ scheduledAt: "2026-02-02T03:04:05.000Z" });
  });

  it("rejects a cron that is not five fields", () => {
    expect(() =>
      defineScheduledTask({
        id: "test.schedule.bad",
        cron: "0 * * * * *",
        run: noop,
      }),
    ).toThrow("TASK_CRON_INVALID:test.schedule.bad:0 * * * * *");
  });
});
