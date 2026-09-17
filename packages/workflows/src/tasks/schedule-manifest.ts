import type { TaskStage } from "./definition";
import { loadAllTaskModules } from "./load";
import { listScheduledTasks } from "./registry";

/**
 * The bridge between the task registry and EventBridge Scheduler.
 *
 * Terraform cannot read TypeScript, so `scripts/generate-schedule-manifest.mjs`
 * writes this manifest to `deploy/app/schedule-manifest.json` and the app root
 * builds one schedule per entry. Cron translation lives here, under test,
 * rather than in HCL: AWS's dialect differs from POSIX in three ways and
 * getting one wrong silently moves a schedule.
 */
export interface ScheduleManifestEntry {
  readonly taskId: string;
  /** The five-field POSIX cron the task declares, in UTC. */
  readonly cron: string;
  /** The same schedule in AWS's six-field dialect, ready for `schedule_expression`. */
  readonly scheduleExpression: string;
  readonly stages: readonly TaskStage[];
}

export interface ScheduleManifest {
  readonly version: 1;
  readonly schedules: readonly ScheduleManifestEntry[];
}

const CRON_FIELDS = 5;
const EVERY = "*";
const ANY = "?";

/**
 * POSIX day-of-week runs 0-6 from Sunday and accepts 7 as a second name for
 * Sunday; AWS runs 1-7 from Sunday. Only day numbers shift: the divisor of a
 * step expression is a count, not a day. 7 wraps back to 1 rather than
 * becoming an 8 that AWS rejects at apply.
 */
function shiftDayOfWeek(field: string): string {
  return field.replaceAll(/(?<![\d/])\d+/gu, (day) =>
    String((Number(day) % 7) + 1),
  );
}

export function toAwsScheduleExpression(posixCron: string): string {
  const fields = posixCron.trim().split(/\s+/u);
  if (fields.length !== CRON_FIELDS)
    throw new Error(`TASK_CRON_INVALID:${posixCron}`);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];
  // AWS refuses a cron that constrains both day fields: exactly one of them is
  // `?`. A schedule that constrains both ("the first Monday of the month") has
  // no AWS translation at all, and dropping either field would run it on days
  // the task never asked for, so it fails here rather than in production.
  if (dayOfMonth !== EVERY && dayOfWeek !== EVERY)
    throw new Error(`TASK_CRON_DAY_CONFLICT:${posixCron}`);
  // A weekday schedule gives up the day-of-month; everything else gives up the
  // day-of-week, which it was not using.
  const byWeekday = dayOfMonth === EVERY && dayOfWeek !== EVERY;
  return byWeekday
    ? `cron(${minute} ${hour} ${ANY} ${month} ${shiftDayOfWeek(dayOfWeek)} *)`
    : `cron(${minute} ${hour} ${dayOfMonth} ${month} ${ANY} *)`;
}

const EVERY_STAGE: readonly TaskStage[] = ["staging", "production"];

/**
 * Loads every task module and describes the scheduled ones. Sorted by task id
 * so the generated file is stable.
 */
export async function buildScheduleManifest(): Promise<ScheduleManifest> {
  await loadAllTaskModules();
  return {
    version: 1,
    schedules: listScheduledTasks().map((task) => ({
      taskId: task.id,
      cron: task.cron,
      scheduleExpression: toAwsScheduleExpression(task.cron),
      stages: task.stages ? [...task.stages] : [...EVERY_STAGE],
    })),
  };
}
