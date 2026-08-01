import type { CoreFinanceWorkflowEngine } from "./engine";
import type { RuntimeBoundaryInstrumentation } from "@clockwork/integrations";

let configuredEngine: CoreFinanceWorkflowEngine | undefined;
let configuredInstrumentation: RuntimeBoundaryInstrumentation | undefined;

/** Called by the Trigger worker bootstrap after constructing real adapters. */
export function configureCoreFinanceWorkflowEngine(
  engine: CoreFinanceWorkflowEngine,
  instrumentation?: RuntimeBoundaryInstrumentation,
): void {
  if (configuredEngine && configuredEngine !== engine)
    throw new Error("Core finance workflow engine is already configured");
  configuredEngine = engine;
  configuredInstrumentation = instrumentation;
}

/** Test-only lifecycle helper; production bootstraps exactly once. */
export function resetCoreFinanceWorkflowEngineForTest(): void {
  if (process.env.NODE_ENV === "production")
    throw new Error("TASK_RUNTIME_RESET_FORBIDDEN");
  configuredEngine = undefined;
  configuredInstrumentation = undefined;
}

export function configuredCoreFinanceWorkflowEngine(): CoreFinanceWorkflowEngine {
  if (!configuredEngine)
    throw new Error(
      "Core finance workflow engine is not configured; initialize provider and repository adapters in the Trigger worker bootstrap",
    );
  return configuredEngine;
}

export function executeConfiguredCoreWorkflow<T>(input: {
  taskId: string;
  triggerRunId: string;
  attempt: number;
  operation(engine: CoreFinanceWorkflowEngine): Promise<T>;
}): Promise<T> {
  const engine = configuredCoreFinanceWorkflowEngine();
  if (!configuredInstrumentation) return input.operation(engine);
  return configuredInstrumentation.workflow({
    name: input.taskId,
    correlation: {
      requestId: `task:${input.triggerRunId}`,
      workflowId: input.taskId,
      taskId: input.triggerRunId,
    },
    attributes: {
      "clockwork.operation": "workflow.execute",
      "workflow.name": input.taskId,
      "workflow.attempt": input.attempt,
    },
    operation: () => input.operation(engine),
  });
}
