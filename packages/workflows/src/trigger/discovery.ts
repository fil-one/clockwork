import { activateTriggerWorkerRuntime } from "../runtime/trigger-worker-bootstrap";
import type { TaskModuleImporter } from "../tasks/load";
import { registerAllTriggerTasks } from "../tasks/trigger-adapter";

export {
  productionTaskImporters,
  type TaskModuleImporter as TriggerTaskImporter,
} from "../tasks/load";

/**
 * Trigger task modules are evaluated only after the durable runtime is active;
 * importing them registers the tasks, and the adapter then presents every
 * registered task to the Trigger SDK.
 */
export async function bootstrapThenDiscoverTriggerTasks(
  input: {
    bootstrap?: () => Promise<unknown>;
    taskImporters?: readonly TaskModuleImporter[];
  } = {},
): Promise<void> {
  await (input.bootstrap ?? activateTriggerWorkerRuntime)();
  await registerAllTriggerTasks(input.taskImporters);
}
