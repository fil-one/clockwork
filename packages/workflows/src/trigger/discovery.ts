import { activateTriggerWorkerRuntime } from "../runtime/trigger-worker-bootstrap";

export type TriggerTaskImporter = () => Promise<unknown>;

const productionTaskImporters: readonly TriggerTaskImporter[] = [
  () => import("../core/tasks"),
  () => import("../core/scheduled-tasks"),
  () => import("../agreements/tasks"),
  () => import("../exceptions/tasks"),
  () => import("../migrations/tasks"),
  () => import("../offboarding/tasks"),
  () => import("../onboarding/tasks"),
  () => import("../pocs/tasks"),
  () => import("../provisioning/tasks"),
  () => import("../quotes/tasks"),
  () => import("../renewals/tasks"),
  () => import("../system/tasks"),
  () => import("../system/gate-activation-tasks"),
];

/** Trigger task modules are evaluated only after the durable runtime is active. */
export async function bootstrapThenDiscoverTriggerTasks(
  input: {
    bootstrap?: () => Promise<unknown>;
    taskImporters?: readonly TriggerTaskImporter[];
  } = {},
): Promise<void> {
  await (input.bootstrap ?? activateTriggerWorkerRuntime)();
  for (const importTasks of input.taskImporters ?? productionTaskImporters)
    await importTasks();
}
