import { describe, expect, it, vi } from "vitest";

import { bootstrapThenDiscoverTriggerTasks } from "./discovery";

describe("Trigger task discovery", () => {
  it("activates the runtime before importing task definitions", async () => {
    const order: string[] = [];
    await bootstrapThenDiscoverTriggerTasks({
      bootstrap: () => {
        order.push("bootstrap");
        return Promise.resolve();
      },
      taskImporters: [
        () => {
          order.push("task-one");
          return Promise.resolve({});
        },
        () => {
          order.push("task-two");
          return Promise.resolve({});
        },
      ],
    });
    expect(order).toEqual(["bootstrap", "task-one", "task-two"]);
  });

  it("does not discover dormant tasks when bootstrap fails", async () => {
    const importer = vi.fn(() => Promise.resolve({}));
    await expect(
      bootstrapThenDiscoverTriggerTasks({
        bootstrap: () => Promise.reject(new Error("configuration missing")),
        taskImporters: [importer],
      }),
    ).rejects.toThrow("configuration missing");
    expect(importer).not.toHaveBeenCalled();
  });
});
