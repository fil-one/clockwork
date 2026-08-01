import { describe, expect, it } from "vitest";

import { createCanonicalPortalProjectionDefinitions } from "./projection-definitions";

const accountId = "10000000-0000-4000-8000-000000000001";
const quoteId = "60000000-0000-4000-8000-000000000001";

describe("canonical portal projection definitions", () => {
  it("maps exact authoritative topics without recursive experience topics", () => {
    const definitions = createCanonicalPortalProjectionDefinitions();
    const topics = definitions.map(({ topic }) => topic);
    expect(new Set(topics).size).toBe(topics.length);
    expect(topics).toContain("core.quotes.expire");
    expect(topics).toContain("core.orders.create");
    expect(topics.some((topic) => topic.startsWith("experience."))).toBe(false);
  });

  it("exposes only the mapped source-version-bound customer action", async () => {
    const definition = createCanonicalPortalProjectionDefinitions().find(
      ({ topic }) => topic === "core.quotes.issue",
    );
    expect(definition).toBeDefined();
    if (!definition) throw new Error("Expected quote issue definition");
    const projections = await definition.project({
      event: {
        eventId: "70000000-0000-4000-8000-000000000001",
        eventType: "core.quotes.issue",
        aggregateType: "quote",
        aggregateId: quoteId,
        aggregateVersion: 3,
        occurredAt: "2026-07-31T16:00:00.000Z",
        requestId: "projection-definition-test",
        actor: { kind: "system", id: "projection-test" },
        data: {},
      },
      state: {
        aggregateType: "quote",
        aggregateId: quoteId,
        accountId,
        version: 3,
        sourceHash: "a".repeat(64),
        sourceUpdatedAt: "2026-07-31T16:00:00.000Z",
        data: { status: "issued", totalMinor: "12500" },
      },
    });
    const customer = projections.find(
      (projection) => projection.audience === "customer",
    );
    expect(customer).toMatchObject({
      audienceAccountId: accountId,
      commandResource: "core:quotes",
    });
    expect(customer?.payload.allowedActions).toEqual(["expire"]);
    const internal = projections.find(
      (projection) => projection.audience === "internal",
    );
    expect(internal).toMatchObject({ commandResource: null });
    expect(internal?.payload.allowedActions).toEqual([]);
  });
});
