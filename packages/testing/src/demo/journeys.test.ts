import { describe, expect, it } from "vitest";

import { demoPersonas } from "../personas/catalog";
import { demoJourneys } from "./journeys";
import { pristineDemoSeed } from "./seed";

/**
 * The deployed pages, taken from the app router. A step route is either one of
 * these exactly or one of the `[id]` parents plus a single seeded identifier.
 */
const listRoutes = new Set([
  "/dashboard",
  "/account",
  "/agreements",
  "/amendments",
  "/billing",
  "/marketplace",
  "/orders",
  "/pocs",
  "/quotes",
  "/services",
  "/support",
  "/internal",
  "/internal/agreements",
  "/internal/approvals",
  "/internal/collections",
  "/internal/gates",
  "/internal/provisioning",
  "/internal/queues",
  "/internal/renewals",
  "/internal/search",
  "/partner",
  "/partner/billing",
  "/partner/commissions",
  "/partner/disputes",
  "/partner/marketplace",
  "/partner/portfolio",
  "/partner/quotes",
  "/partner/registrations",
  "/partner/renewals",
  "/partner/support",
]);

const detailRoutes = new Set([
  "/agreements",
  "/billing",
  "/orders",
  "/pocs",
  "/quotes",
  "/internal/accounts",
  "/internal/queues",
  "/partner/portfolio",
  "/partner/quotes",
]);

function seededIdentifiers(): ReadonlySet<string> {
  const ids = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    for (const [key, entry] of Object.entries(record)) {
      if ((key === "id" || key === "slug") && typeof entry === "string")
        ids.add(entry);
      walk(entry);
    }
  };
  walk(pristineDemoSeed);
  return ids;
}

describe("mocked web journeys", () => {
  it("provides a non-empty, coherent journey for every required persona", () => {
    const journeyPersonas = new Set(
      Object.values(demoJourneys).map(({ persona }) => persona),
    );

    expect(journeyPersonas).toEqual(new Set(Object.keys(demoPersonas)));
    for (const journey of Object.values(demoJourneys)) {
      expect(journey.steps.length).toBeGreaterThan(0);
      for (const step of journey.steps)
        expect(step.expectedFixtureId).not.toHaveLength(0);
    }
  });

  it("points every step at a deployed page", () => {
    const unreachable = Object.entries(demoJourneys).flatMap(([key, journey]) =>
      journey.steps
        .filter(
          (step) =>
            !listRoutes.has(step.route) &&
            !detailRoutes.has(step.route.slice(0, step.route.lastIndexOf("/"))),
        )
        .map((step) => `${key}: ${step.route}`),
    );

    expect(unreachable).toEqual([]);
  });

  it("addresses only identifiers the seed carries", () => {
    const ids = seededIdentifiers();
    for (const journey of Object.values(demoJourneys))
      for (const step of journey.steps) {
        if (listRoutes.has(step.route)) continue;
        expect(ids).toContain(
          step.route.slice(step.route.lastIndexOf("/") + 1),
        );
      }
  });
});
