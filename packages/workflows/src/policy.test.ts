import { describe, expect, it } from "vitest";

import { workflowIdempotencyKey } from "./policy";

describe("workflow idempotency", () => {
  it("is stable across payload retries and changes across aggregate versions", () => {
    const base = {
      aggregateType: "order",
      aggregateId: "80000000-0000-4000-8000-000000000001",
      aggregateVersion: 2,
      operation: "provision",
      payload: { attempt: 1 },
    };
    expect(workflowIdempotencyKey(base)).toBe(
      workflowIdempotencyKey({ ...base, payload: { attempt: 999 } }),
    );
    expect(workflowIdempotencyKey(base)).not.toBe(
      workflowIdempotencyKey({ ...base, aggregateVersion: 3 }),
    );
  });
});
