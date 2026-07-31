import { describe, expect, it } from "vitest";

import { lifecycleEventTypes } from "./events";

describe("lifecycle event catalog", () => {
  it("keeps every audit/outbox topic unique and convention-safe", () => {
    const eventTypes = Object.values(lifecycleEventTypes);
    expect(new Set(eventTypes).size).toBe(eventTypes.length);
    expect(
      eventTypes.every((eventType) => /^[a-z][a-z0-9_.-]+$/.test(eventType)),
    ).toBe(true);
  });
});
