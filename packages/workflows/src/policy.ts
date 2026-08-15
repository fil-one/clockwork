import { createHash } from "node:crypto";

import { z } from "zod";

export const WorkflowInvocationSchema = z.object({
  aggregateType: z.string().min(1),
  aggregateId: z.uuid(),
  aggregateVersion: z.int().positive(),
  operation: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export type WorkflowInvocation = z.infer<typeof WorkflowInvocationSchema>;

export function workflowIdempotencyKey(input: WorkflowInvocation): string {
  const canonical = `${input.aggregateType}:${input.aggregateId}:${input.aggregateVersion}:${input.operation}`;
  return `workflow:${createHash("sha256").update(canonical).digest("hex")}`;
}

/**
 * Trigger computes and sleeps these delays itself, so the jitter is a flag here
 * rather than an injected source: nothing in this repository derives a time
 * from this object and no test can pin one. Without it every run failed by the
 * same provider outage wakes in the same millisecond and re-forms the herd.
 */
export const durableRetryPolicy = {
  maxAttempts: 8,
  factor: 2,
  minTimeoutInMs: 1_000,
  maxTimeoutInMs: 300_000,
  randomize: true,
} as const;
