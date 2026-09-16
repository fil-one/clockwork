import type { ScheduledPayload, TaskDefinition } from "./definition";

/**
 * Every task the application defines, keyed by id. Populated as a side effect
 * of importing the task modules; `loadAllTaskModules` imports the production
 * set. Both runtime adapters read from here and nothing else.
 */
const registry = new Map<string, TaskDefinition>();

export function registerTask<TPayload>(
  definition: TaskDefinition<TPayload>,
): TaskDefinition<TPayload> {
  if (registry.has(definition.id))
    throw new Error(`TASK_ALREADY_REGISTERED:${definition.id}`);
  registry.set(definition.id, definition as TaskDefinition);
  return definition;
}

export function getTask(id: string): TaskDefinition | undefined {
  return registry.get(id);
}

export function listTasks(): readonly TaskDefinition[] {
  return [...registry.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export type ScheduledTaskDefinition = TaskDefinition<ScheduledPayload> & {
  readonly cron: string;
};

export function listScheduledTasks(): readonly ScheduledTaskDefinition[] {
  return listTasks().filter(
    (task): task is ScheduledTaskDefinition =>
      task.kind === "scheduled" && typeof task.cron === "string",
  );
}

/** Tests define tasks of their own; production never clears the registry. */
export function resetTaskRegistryForTests(): void {
  if (process.env.NODE_ENV === "production")
    throw new Error("TASK_REGISTRY_RESET_REFUSED_IN_PRODUCTION");
  registry.clear();
  loaded = undefined;
}

export type TaskModuleImporter = () => Promise<unknown>;

/**
 * The production task modules. Exported so a test can drive the same list
 * discovery uses rather than a second copy of it.
 */
export const productionTaskImporters: readonly TaskModuleImporter[] = [
  () => import("../core/tasks"),
  () => import("../core/scheduled-tasks"),
  () => import("../core/payg-scheduled-tasks"),
  () => import("../core/price-book-scheduled-tasks"),
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
  () => import("../webhook-replay/tasks"),
];

let loaded: Promise<void> | undefined;

/**
 * Imports every production task module once, which registers every task.
 * Carries no database bootstrap: a host activates the workflow runtime first
 * and then calls this.
 */
export function loadAllTaskModules(
  importers: readonly TaskModuleImporter[] = productionTaskImporters,
): Promise<void> {
  if (importers !== productionTaskImporters)
    return importers.reduce<Promise<void>>(
      (chain, importModule) => chain.then(() => importModule()).then(() => {}),
      Promise.resolve(),
    );
  loaded ??= productionTaskImporters.reduce<Promise<void>>(
    (chain, importModule) => chain.then(() => importModule()).then(() => {}),
    Promise.resolve(),
  );
  return loaded;
}
