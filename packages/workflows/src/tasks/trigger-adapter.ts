import { schedules, task } from "@trigger.dev/sdk";

import type { TaskDefinition, TaskStage } from "./definition";
import { loadAllTaskModules, type TaskModuleImporter } from "./load";
import { listTasks } from "./registry";

/**
 * Presents a registered task to Trigger.dev.
 *
 * Trigger discovers tasks by evaluating the modules under `trigger/`, so the
 * adapter's whole job is to call `task()` or `schedules.task()` once per
 * definition and translate at the boundary: the run context flattens
 * (`ctx.run.id`, `ctx.attempt.number`), and a schedule occurrence arrives as a
 * `Date` that becomes the ISO `scheduledAt` the task contract promises.
 */
const TRIGGER_ENVIRONMENT: Record<TaskStage, "STAGING" | "PRODUCTION"> = {
  staging: "STAGING",
  production: "PRODUCTION",
};

interface TriggerRunContext {
  readonly run: { readonly id: string };
  readonly attempt: { readonly number: number };
}

/** Trigger takes a duration string; whole minutes read better in the dashboard. */
function triggerDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1_000);
  return seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;
}

export function toTriggerTask(definition: TaskDefinition): unknown {
  if (definition.kind === "on_demand")
    return task({
      id: definition.id,
      retry: { ...definition.retry },
      // Async so a rejected payload surfaces as a failed run rather than a
      // synchronous throw out of the SDK's call site.
      run: async (raw: unknown, { ctx }: { ctx: TriggerRunContext }) =>
        definition.run(definition.parse(raw), {
          runId: ctx.run.id,
          attempt: ctx.attempt.number,
        }),
    });

  if (!definition.cron) throw new Error(`TASK_CRON_MISSING:${definition.id}`);
  return schedules.task({
    id: definition.id,
    cron: {
      pattern: definition.cron,
      timezone: "UTC",
      ...(definition.stages
        ? {
            environments: definition.stages.map(
              (stage) => TRIGGER_ENVIRONMENT[stage],
            ),
          }
        : {}),
    },
    ...(definition.deliveryTtlMs === undefined
      ? {}
      : { ttl: triggerDuration(definition.deliveryTtlMs) }),
    retry: { ...definition.retry },
    run: async (
      payload: { timestamp: Date },
      { ctx }: { ctx: TriggerRunContext },
    ) => {
      const scheduledAt = payload.timestamp.toISOString();
      return definition.run(definition.parse({ scheduledAt }), {
        runId: ctx.run.id,
        attempt: ctx.attempt.number,
        scheduledAt,
      });
    },
  });
}

/** Loads every task module, then presents what they registered to Trigger. */
export async function registerAllTriggerTasks(
  importers?: readonly TaskModuleImporter[],
): Promise<void> {
  await loadAllTaskModules(importers);
  for (const definition of listTasks()) toTriggerTask(definition);
}
