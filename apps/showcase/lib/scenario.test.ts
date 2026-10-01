import { describe, expect, it } from "vitest";
import {
  economics,
  initialScenario,
  parseStep,
  restoreScenario,
  scenarioReducer,
} from "./scenario";
describe("sales-demo transaction integrity", () => {
  it("carries consistent economics through a complete transaction", () => {
    let state = scenarioReducer(initialScenario, {
      type: "capacity",
      value: 1500,
    });
    for (const step of [0, 1, 2])
      state = scenarioReducer(state, { type: "complete", step });
    expect(state.completed).toBe(3);
    expect(scenarioReducer(state, { type: "complete", step: 4 })).toEqual(
      state,
    );
    expect(scenarioReducer(state, { type: "confirm" })).toEqual(state);
    state = scenarioReducer(state, { type: "request" });
    expect(state.completed).toBe(3);
    state = scenarioReducer(state, { type: "confirm" });
    state = scenarioReducer(state, { type: "complete", step: 4 });
    expect(state.completed).toBe(5);
    expect(economics(state.capacity)).toEqual({
      listMonthly: 7500,
      monthly: 6750,
      annual: 81000,
      discount: 750,
    });
    expect(scenarioReducer(state, { type: "complete", step: 4 })).toEqual(
      state,
    );
    expect(scenarioReducer(state, { type: "capacity", value: 100 })).toEqual(
      state,
    );
  });
  it("keeps delayed provisioning inactive and requires retry before confirmation", () => {
    let state = scenarioReducer(initialScenario, { type: "prepare", step: 3 });
    state = scenarioReducer(state, { type: "request" });
    state = scenarioReducer(state, { type: "delay" });
    expect(state.completed).toBe(3);
    expect(scenarioReducer(state, { type: "confirm" })).toEqual(state);
    state = scenarioReducer(state, { type: "request" });
    state = scenarioReducer(state, { type: "confirm" });
    expect(state.completed).toBe(4);
    expect(state.provisioning).toBe("confirmed");
  });
  it("marks shortcuts explicitly and resets every mutable field", () => {
    const state = scenarioReducer(
      { ...initialScenario, capacity: 2000 },
      { type: "prepare", step: 4 },
    );
    expect(state).toMatchObject({
      completed: 4,
      seeded: true,
      provisioning: "confirmed",
    });
    expect(scenarioReducer(state, { type: "reset" })).toEqual(initialScenario);
  });
  it.each([
    null,
    "{}",
    "not json",
    JSON.stringify({ ...initialScenario, completed: 4 }),
    JSON.stringify({ ...initialScenario, capacity: Infinity }),
    JSON.stringify({ ...initialScenario, capacity: 100.5 }),
    JSON.stringify({
      ...initialScenario,
      completed: 3,
      provisioning: "confirmed",
    }),
    JSON.stringify({ ...initialScenario, version: 2 }),
  ])("recovers safely from invalid stored state: %s", (raw) => {
    expect(restoreScenario(raw)).toEqual(initialScenario);
  });
  it("restores valid partial and finished scenarios without losing history", () => {
    for (const step of [1, 2, 3, 4]) {
      const state = scenarioReducer(initialScenario, { type: "prepare", step });
      expect(restoreScenario(JSON.stringify(state))).toEqual(state);
    }
  });
  it.each(["-1", "5", "NaN", "1.5", "1e0", "01", "Infinity", ""])(
    "rejects malformed scene links: %s",
    (raw) => expect(parseStep(raw)).toBe(0),
  );
  it("accepts only intended scene links", () =>
    expect([0, 1, 2, 3, 4].map((x) => parseStep(String(x)))).toEqual([
      0, 1, 2, 3, 4,
    ]));
});
