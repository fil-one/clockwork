import type { ScheduledPayload, TaskDefinition } from "./definition";

/**
 * Every task the application defines, keyed by id. Populated as a side effect
 * of importing the task modules; `loadAllTaskModules` in `./load` imports the
 * production set. Both runtime adapters read from here and nothing else.
 */
const registry = new Map<string, TaskDefinition>();

export function registerTask<TPayload>(
  definition: TaskDefinition<TPayload>,
): TaskDefinition<TPayload> {
  if (registry.has(definition.id))
    throw new Error(`TASK_ALREADY_REGISTERED:${definition.id}`);
  registry.set(definition.id, definition);
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
}
