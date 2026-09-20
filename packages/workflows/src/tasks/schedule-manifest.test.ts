import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildScheduleManifest,
  toAwsScheduleExpression,
} from "./schedule-manifest";

const committedManifest = JSON.parse(
  readFileSync(
    new URL("../../../../deploy/app/schedule-manifest.json", import.meta.url),
    "utf8",
  ),
) as unknown;

describe("toAwsScheduleExpression", () => {
  // AWS takes six fields and refuses a cron that constrains both day fields,
  // so exactly one of them is `?`. POSIX Sunday is 0; AWS Sunday is 1.
  const conversions: readonly (readonly [string, string])[] = [
    ["0 8 * * 1", "cron(0 8 ? * 2 *)"],
    ["15 * * * *", "cron(15 * * * ? *)"],
    ["0 6 1 */3 *", "cron(0 6 1 */3 ? *)"],
    ["0 0 * * 0", "cron(0 0 ? * 1 *)"],
    ["30 3 * * 6", "cron(30 3 ? * 7 *)"],
    ["*/5 * * * *", "cron(*/5 * * * ? *)"],
    ["0 2 1 * *", "cron(0 2 1 * ? *)"],
    ["0 9 * * 1-5", "cron(0 9 ? * 2-6 *)"],
    ["45 23 L * *", "cron(45 23 L * ? *)"],
    // POSIX allows 7 as a second name for Sunday; AWS Sunday is 1, and 8 is
    // rejected at apply.
    ["0 4 * * 7", "cron(0 4 ? * 1 *)"],
    ["0 4 * * 0,7", "cron(0 4 ? * 1,1 *)"],
  ];

  it.each(conversions)("converts %s", (posix, expected) => {
    expect(toAwsScheduleExpression(posix)).toBe(expected);
  });

  it("refuses a cron that is not five fields", () => {
    expect(() => toAwsScheduleExpression("0 8 * *")).toThrow(
      /TASK_CRON_INVALID/u,
    );
  });

  it("refuses a cron that constrains both day fields", () => {
    // "the first Monday of the month" is a POSIX cron AWS cannot express;
    // translating it would silently run on all seven days.
    expect(() => toAwsScheduleExpression("0 8 1-7 * 1")).toThrow(
      /TASK_CRON_DAY_CONFLICT/u,
    );
  });
});

// Whichever of these runs first pays for importing all sixteen production task
// modules, and on a cold Vite transform cache that alone has been measured at
// over five seconds under full-suite load (about 2.5s warm). The default 5s
// timeout therefore fails on a fresh CI checkout and passes on a rerun; the
// work being timed is module loading, not anything these tests assert.
describe("buildScheduleManifest", { timeout: 60_000 }, () => {
  // The committed manifest is what Terraform reads, so it must match what the
  // task registry says today. Until the scheduled tasks are converted to
  // `defineScheduledTask` and `pnpm generate:schedules` has been run, the
  // committed file is the empty placeholder and this test fails; the verify
  // stage's `check:generated` regenerates it and keeps it from drifting after.
  it("matches the manifest committed for Terraform", async () => {
    const manifest = await buildScheduleManifest();
    expect(committedManifest).toEqual(manifest);
  });

  it("covers every scheduled task", async () => {
    const manifest = await buildScheduleManifest();
    expect(manifest.version).toBe(1);
    expect(manifest.schedules).toHaveLength(27);
  });

  it("sorts entries by task id and converts each cron", async () => {
    const manifest = await buildScheduleManifest();
    const ids = manifest.schedules.map((entry) => entry.taskId);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
    for (const entry of manifest.schedules)
      expect(entry.scheduleExpression).toBe(
        toAwsScheduleExpression(entry.cron),
      );
  });
});
