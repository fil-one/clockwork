import type { CoreFinanceWorkflowEngine } from "./engine";

let configuredEngine: CoreFinanceWorkflowEngine | undefined;

/** Called by the Trigger worker bootstrap after constructing real adapters. */
export function configureCoreFinanceWorkflowEngine(
  engine: CoreFinanceWorkflowEngine,
): void {
  if (configuredEngine && configuredEngine !== engine)
    throw new Error("Core finance workflow engine is already configured");
  configuredEngine = engine;
}

/** Test-only lifecycle helper; production bootstraps exactly once. */
export function resetCoreFinanceWorkflowEngineForTest(): void {
  if (process.env.NODE_ENV === "production")
    throw new Error("TASK_RUNTIME_RESET_FORBIDDEN");
  configuredEngine = undefined;
}

export function configuredCoreFinanceWorkflowEngine(): CoreFinanceWorkflowEngine {
  if (!configuredEngine)
    throw new Error(
      "Core finance workflow engine is not configured; initialize provider and repository adapters in the Trigger worker bootstrap",
    );
  return configuredEngine;
}
