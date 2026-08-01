import { task } from "@trigger.dev/sdk";
import { z } from "zod";

import { ExternalGateKeySchema } from "@clockwork/domain/system";

import { durableRetryPolicy } from "../policy";
import { externalGateActivationTaskIds } from "../runtime/gate-activation";

const ActivationPayloadSchema = z.object({
  taskKey: z.string().min(8).max(255),
  gateKey: ExternalGateKeySchema,
  provider: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
});

export type ExternalGateActivationTaskPayload = z.infer<
  typeof ActivationPayloadSchema
>;

export type ExternalGateActivationExecutor = (
  payload: ExternalGateActivationTaskPayload,
  requestId: string,
) => Promise<unknown>;

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

export const externalGateActivationTask = task({
  id: externalGateActivationTaskIds.activate,
  retry: durableRetryPolicy,
  run: (payload: unknown, { ctx }) =>
    executeConfiguredExternalGateActivation(payload, `task:${ctx.run.id}`),
});

/** Same durable handler; provider_succeeded state selects recovery without HTTP. */
export const externalGateActivationRecoveryTask = task({
  id: externalGateActivationTaskIds.recover,
  retry: durableRetryPolicy,
  run: (payload: unknown, { ctx }) =>
    executeConfiguredExternalGateActivation(payload, `recovery:${ctx.run.id}`),
});
