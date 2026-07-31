import { describe, expect, it } from "vitest";

import { FakeProviderKernel, ImmediateScheduler } from "./scenario";

describe("fake provider scenarios", () => {
  it("models delay, transient failure, duplicates, and reversed callbacks deterministically", async () => {
    const scheduler = new ImmediateScheduler();
    const kernel = new FakeProviderKernel(scheduler);
    kernel.enqueue("operation", {
      outcome: "transient_failure",
      delayMs: 250,
      duplicate: true,
      callbackOrder: "reverse",
      callbacks: [
        { id: "first", type: "started", payload: {} },
        { id: "second", type: "finished", payload: {} },
      ],
    });
    const result = await kernel.execute("operation", {}, () => "unused");
    expect(result).toMatchObject({ ok: false, kind: "transient" });
    expect(scheduler.delays).toEqual([250]);
    expect(kernel.drainCallbacks().map(({ id }) => id)).toEqual([
      "second",
      "second",
      "first",
      "first",
    ]);
  });
});
