import { describe, expect, it } from "vitest";

import { demoPersonas } from "../personas/catalog";
import {
  experienceStateCatalog,
  visualScenarios,
  visualScenarioUrl,
  visualSnapshotName,
  visualViewports,
} from "./scenarios";

describe("visual journey fixtures", () => {
  it("keeps the 320px acceptance floor and deterministic snapshot names", () => {
    expect(visualViewports.mobile320.width).toBe(320);

    for (const scenario of visualScenarios) {
      expect(visualSnapshotName(scenario)).toMatch(
        /^[a-z0-9-]+-(mobile320|mobile390|tablet|desktop)-(light|dark)\.png$/,
      );
      expect(visualScenarioUrl(scenario)).toContain(
        `experienceState=${scenario.state}`,
      );
    }
  });

  it("references real demo personas and safe fictional routes", () => {
    for (const scenario of visualScenarios) {
      expect(demoPersonas[scenario.persona]).toBeDefined();
      const url = new URL(visualScenarioUrl(scenario));
      expect(url.hostname).toBe("commerce.clockwork.test");
      expect(url.searchParams.get("demo")).toBe("true");
    }
  });

  it("catalogs every designed asynchronous and failure state", () => {
    expect(new Set(experienceStateCatalog)).toEqual(
      new Set([
        "empty",
        "loading",
        "offline",
        "optimistic",
        "partial",
        "permission_denied",
        "ready",
        "recoverable_error",
        "stale_version",
        "success",
        "unrecoverable_error",
        "validation_error",
      ]),
    );
  });
});
