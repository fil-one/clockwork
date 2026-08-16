import { idempotencyKeys, task, tasks } from "@trigger.dev/sdk";
import { z } from "zod";

import { ExternalGateKeySchema } from "@clockwork/domain/system";

import { durableRetryPolicy } from "../policy";
import { externalGateActivationTaskIds } from "../runtime/gate-activation";

const ActivationPayloadSchema = z.object({
  taskKey: z.string().min(8).max(255),
  gateKey: ExternalGateKeySchema,
  provider: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
  expectedGateRowVersion: z.number().int().positive(),
  requestedBy: z.uuid(),
});

export type ExternalGateActivationTaskPayload = z.infer<
  typeof ActivationPayloadSchema
>;

export type ExternalGateActivationExecutor = (
  payload: ExternalGateActivationTaskPayload,
  requestId: string,
) => Promise<unknown>;

/** Web/API submission boundary; Trigger provides the durable idempotent queue. */
export class TriggerExternalGateActivationTaskSubmitter {
  public async enqueue(input: {
    gateKey: ExternalGateActivationTaskPayload["gateKey"];
    expectedGateRowVersion: number;
    taskKey: string;
    provider: string;
    idempotencyKey: string;
    actor: { kind: "user" | "system"; id: string };
    requestId: string;
    now: Date;
  }) {
    if (input.actor.kind !== "user")
      throw new Error("EXTERNAL_GATE_ACTIVATION_OPERATOR_REQUIRED");
    const idempotencyKey = await idempotencyKeys.create(input.idempotencyKey, {
      scope: "global",
    });
    const run = await tasks.trigger(
      externalGateActivationTaskIds.activate,
      ActivationPayloadSchema.parse({
        taskKey: input.taskKey,
        gateKey: input.gateKey,
        provider: input.provider,
        expectedGateRowVersion: input.expectedGateRowVersion,
        requestedBy: input.actor.id,
      }),
      { idempotencyKey },
    );
    return {
      runId: run.id,
      taskKey: input.taskKey,
      gateKey: input.gateKey,
      provider: input.provider,
      expectedGateRowVersion: input.expectedGateRowVersion,
      status: "queued" as const,
      submittedAt: input.now.toISOString(),
    };
  }
}

let configuredExecutor: ExternalGateActivationExecutor | undefined;

export function configureExternalGateActivationExecutor(
  executor: ExternalGateActivationExecutor,
): void {
  if (configuredExecutor && configuredExecutor !== executor)
    throw new Error("EXTERNAL_GATE_ACTIVATION_EXECUTOR_ALREADY_CONFIGURED");
  configuredExecutor = executor;
}

export function resetExternalGateActivationExecutorForTests(): void {
  if (process.env.NODE_ENV === "production")
    throw new Error("EXTERNAL_GATE_ACTIVATION_EXECUTOR_RESET_FORBIDDEN");
  configuredExecutor = undefined;
}

export function executeConfiguredExternalGateActivation(
  raw: unknown,
  requestId: string,
) {
  if (!configuredExecutor)
    throw new Error("EXTERNAL_GATE_ACTIVATION_EXECUTOR_NOT_CONFIGURED");
  return configuredExecutor(ActivationPayloadSchema.parse(raw), requestId);
}

/**
 * The only registered gate-activation task. Crash recovery arrives on this id
 * too: the runner behind `executeConfiguredExternalGateActivation` finalises a
 * `provider_succeeded` task without a second HTTP probe, so a retry of this
 * task is the recovery path. A separate recovery id used to be registered here
 * with the identical handler and no caller of any kind; see
 * `externalGateActivationTaskIds`.
 */
export const externalGateActivationTask = task({
  id: externalGateActivationTaskIds.activate,
  retry: durableRetryPolicy,
  run: (payload: unknown, { ctx }) =>
    executeConfiguredExternalGateActivation(payload, `task:${ctx.run.id}`),
});
