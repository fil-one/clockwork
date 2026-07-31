import { describe, expect, it } from "vitest";

import { demoPersonas } from "../personas/catalog";
import { demoJourneys } from "./journeys";

describe("mocked web journeys", () => {
  it("provides a non-empty, coherent journey for every required persona", () => {
    const journeyPersonas = new Set(
      Object.values(demoJourneys).map(({ persona }) => persona),
    );

    expect(journeyPersonas).toEqual(new Set(Object.keys(demoPersonas)));
    for (const journey of Object.values(demoJourneys)) {
      expect(journey.steps.length).toBeGreaterThan(0);
      for (const step of journey.steps) {
        expect(step.route).toMatch(/^\/(client|partner|internal)/);
        expect(step.expectedFixtureId).not.toHaveLength(0);
      }
    }
  });
});
