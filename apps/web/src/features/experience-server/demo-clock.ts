import { findDemoProductionMarker } from "@clockwork/testing/demo-state";

export const DEMO_CLOCK_ENVIRONMENT_KEY = "CLOCKWORK_DEMO_CLOCK" as const;

/**
 * "Now" for a demo read. Demo screens count days from today ("in 22 days",
 * "overdue") and print the time they were read, so a screenshot taken on
 * another day lays out differently. Test servers pin the instant with
 * `CLOCKWORK_DEMO_CLOCK`; the hosted demo leaves it unset and reads the wall
 * clock. The pin is honoured only by the explicit demo adapter outside
 * production, so it can never move a real deployment's clock.
 */
export function demoNow(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Date {
  const pinned = environment[DEMO_CLOCK_ENVIRONMENT_KEY]?.trim();
  if (
    pinned &&
    environment.CLOCKWORK_EXPERIENCE_ADAPTER?.trim() === "demo" &&
    !findDemoProductionMarker(environment)
  ) {
    const time = Date.parse(pinned);
    if (Number.isFinite(time)) return new Date(time);
  }
  return new Date();
}
