import { describe, expect, it } from "vitest";

import { experienceStateCatalog, stateGalleryContract } from "./scenarios";

describe("reachable state gallery contract", () => {
  it("points only to the current gallery and its executed viewport floors", () => {
    expect(stateGalleryContract.route).toBe("/states");
    expect(stateGalleryContract.requiredViewportWidths).toEqual([1440, 320]);
  });

  it("catalogs every designed asynchronous and failure state", () => {
    expect(new Set(experienceStateCatalog)).toEqual(
      new Set([
        "empty",
        "loading",
        "offline",
        "optimistic",
        "partial",
        "permission",
        "recoverable-error",
        "stale",
        "success",
        "fatal-error",
        "validation",
      ]),
    );
  });
});
