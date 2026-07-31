import { describe, expect, it } from "vitest";

import { runDurableTask } from "./runner";

describe("Trigger.dev task test harness", () => {
  it("retries deterministic transient failures", async () => {
    const result = await runDurableTask("input", (_input, attempt) => {
      if (attempt < 3) return Promise.reject(new Error("transient"));
      return Promise.resolve("done");
    });
    expect(result).toMatchObject({ output: "done", attempts: 3 });
    expect(result.errors).toHaveLength(2);
  });
});
