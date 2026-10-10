import { createRuntimeDatabase, type RuntimeDatabase } from "@clockwork/db";

import {
  activateWorkflowRuntime,
  createWorkflowRuntime,
  resetWorkflowRuntimeBootstrapForTests,
  WorkflowBootstrapConfigurationError,
  workflowRuntimeStatus,
  type ActivatableWorkflowRuntime,
  type ProductionWorkflowAdapterFactory,
  type ProductionWorkflowRuntime,
  type WorkflowRuntimeEnvironment,
} from "./workflow-runtime";

export {
  activateWorkflowRuntime,
  createWorkflowRuntime,
  resetWorkflowRuntimeBootstrapForTests,
  validateWorkflowRuntimeEnvironment,
  WorkflowBootstrapConfigurationError,
  workflowRuntimeStatus,
  type ActivatableWorkflowRuntime,
  type CreateWorkflowRuntimeInput,
  type ProductionWorkflowAdapterBundle,
  type ProductionWorkflowAdapterFactory,
  type ProductionWorkflowRuntime,
  type WorkflowRuntimeEnvironment,
  type WorkflowRuntimeEnvironmentSource,
} from "./workflow-runtime";

export interface TriggerWorkerEnvironment extends WorkflowRuntimeEnvironment {
  directDatabaseUrl: string;
  triggerProjectRef: string;
  triggerSecretKey: string;
}

export type TriggerWorkerEnvironmentSource = Readonly<
  Record<string, string | undefined>
>;

function required(
  source: TriggerWorkerEnvironmentSource,
  name: string,
): string {
  const value = source[name]?.trim();
  if (!value)
    throw new WorkflowBootstrapConfigurationError([name], ["EXT-ACC-01"]);
  return value;
}

export function validateTriggerWorkerEnvironment(
  source: TriggerWorkerEnvironmentSource,
): TriggerWorkerEnvironment {
  const runtimeEnvironment = required(source, "NODE_ENV");
  if (!["development", "test", "production"].includes(runtimeEnvironment))
    throw new WorkflowBootstrapConfigurationError(["NODE_ENV"], ["EXT-ACC-01"]);
  const directDatabaseUrl = required(source, "DIRECT_DATABASE_URL");
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(directDatabaseUrl);
  } catch {
    throw new WorkflowBootstrapConfigurationError(
      ["DIRECT_DATABASE_URL"],
      ["EXT-ACC-01"],
    );
  }
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol))
    throw new WorkflowBootstrapConfigurationError(
      ["DIRECT_DATABASE_URL"],
      ["EXT-ACC-01"],
    );
  if (
    runtimeEnvironment === "production" &&
    ["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname)
  )
    throw new WorkflowBootstrapConfigurationError(
      ["DIRECT_DATABASE_URL:production_target_required"],
      ["EXT-ACC-01"],
    );
  const triggerProjectRef = required(source, "TRIGGER_PROJECT_REF");
  if (!/^proj_[A-Za-z0-9_-]+$/.test(triggerProjectRef))
    throw new WorkflowBootstrapConfigurationError(
      ["TRIGGER_PROJECT_REF"],
      ["EXT-ACC-01"],
    );
  const triggerSecretKey = required(source, "TRIGGER_SECRET_KEY");
  if (!triggerSecretKey.startsWith("tr_") || triggerSecretKey.length < 16)
    throw new WorkflowBootstrapConfigurationError(
      ["TRIGGER_SECRET_KEY"],
      ["EXT-ACC-01"],
    );
  return {
    runtimeEnvironment:
      runtimeEnvironment as TriggerWorkerEnvironment["runtimeEnvironment"],
    directDatabaseUrl,
    triggerProjectRef,
    triggerSecretKey,
  };
}
/**
 * The worker opens its own direct connection -- no pooler in front of it, so a
 * transaction survives a long provider call -- and hands it to the neutral
 * bootstrap. A failure closes the client rather than leaving the pool open
 * behind a process that will not serve.
 */
export async function createEnvironmentProductionWorkflowRuntime(
  input: {
    source?: TriggerWorkerEnvironmentSource;
    adapterFactory?: ProductionWorkflowAdapterFactory;
    readCapabilities?: (db: RuntimeDatabase) => Promise<
      readonly {
        capabilityKey: string;
        enabled: boolean;
        recoveryEnabled: boolean;
      }[]
    >;
  } = {},
): Promise<ProductionWorkflowRuntime> {
  const source = input.source ?? process.env;
  const environment = validateTriggerWorkerEnvironment(source);
  const { client, db } = createRuntimeDatabase({
    url: environment.directDatabaseUrl,
    role: "clockwork_service",
  });
  try {
    return await createWorkflowRuntime({
      db,
      source,
      ...(input.adapterFactory ? { adapterFactory: input.adapterFactory } : {}),
      ...(input.readCapabilities
        ? { readCapabilities: input.readCapabilities }
        : {}),
    });
  } catch (error) {
    await client.end();
    throw error;
  }
}

export function triggerWorkerBootstrapStatus():
  "inactive" | "activating" | "active" {
  return workflowRuntimeStatus();
}

export function activateTriggerWorkerRuntime(
  load: () => Promise<ActivatableWorkflowRuntime> = () =>
    createEnvironmentProductionWorkflowRuntime(),
): Promise<ActivatableWorkflowRuntime> {
  return activateWorkflowRuntime(load);
}

export function resetTriggerWorkerBootstrapForTests(): void {
  resetWorkflowRuntimeBootstrapForTests();
}
