import { expect, it } from "vitest";
import { demoNow } from "./demo-clock";

const pinned = "2026-10-05T02:00:00.000Z";

it("reads the pinned instant under the explicit demo adapter", () => {
  expect(
    demoNow({
      CLOCKWORK_EXPERIENCE_ADAPTER: "demo",
      CLOCKWORK_DEMO_CLOCK: pinned,
    }).toISOString(),
  ).toBe(pinned);
});

it("reads the wall clock everywhere else", () => {
  const before = Date.now();
  for (const environment of [
    { CLOCKWORK_DEMO_CLOCK: pinned },
    { CLOCKWORK_EXPERIENCE_ADAPTER: "database", CLOCKWORK_DEMO_CLOCK: pinned },
    {
      CLOCKWORK_EXPERIENCE_ADAPTER: "demo",
      CLOCKWORK_DEMO_CLOCK: pinned,
      CLOCKWORK_ENV: "production",
    },
    { CLOCKWORK_EXPERIENCE_ADAPTER: "demo", CLOCKWORK_DEMO_CLOCK: "soon" },
    { CLOCKWORK_EXPERIENCE_ADAPTER: "demo" },
  ])
    expect(demoNow(environment).getTime()).toBeGreaterThanOrEqual(before);
});
