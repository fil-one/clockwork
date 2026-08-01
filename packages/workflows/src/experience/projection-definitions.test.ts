import { describe, expect, it } from "vitest";

import {
  aggregatesWithoutAuthoritativeEvents,
  createCanonicalPortalProjectionDefinitions,
} from "./projection-definitions";

const accountId = "10000000-0000-4000-8000-000000000001";
const partnerAccountId = "20000000-0000-4000-8000-000000000002";
const quoteId = "60000000-0000-4000-8000-000000000001";

async function projectQuote(
  data: Readonly<Record<string, unknown>>,
  topic = "core.quotes.issue",
) {
  const definition = createCanonicalPortalProjectionDefinitions().find(
    (candidate) => candidate.topic === topic,
  );
  if (!definition) throw new Error(`Expected a ${topic} definition`);
  return definition.project({
    event: {
      eventId: "70000000-0000-4000-8000-000000000001",
      eventType: topic,
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
      data,
    },
  });
}

describe("canonical portal projection definitions", () => {
  it("maps exact authoritative topics without recursive experience topics", () => {
    const definitions = createCanonicalPortalProjectionDefinitions();
    const topics = definitions.map(({ topic }) => topic);
    expect(new Set(topics).size).toBe(topics.length);
    expect(topics).toContain("core.quotes.expire");
    expect(topics).toContain("core.orders.create");
    expect(topics.some((topic) => topic.startsWith("experience."))).toBe(false);
  });

  it("registers no topic for an aggregate that emits no authoritative event", () => {
    const topics = createCanonicalPortalProjectionDefinitions().map(
      ({ topic }) => topic,
    );
    for (const aggregate of aggregatesWithoutAuthoritativeEvents)
      expect(topics.some((topic) => topic.includes(aggregate))).toBe(false);
  });

  it("grants the customer only the action that needs no further input", async () => {
    const projections = await projectQuote({
      status: "issued",
      totalMinor: "12500",
      currency: "USD",
    });
    const customer = projections.find(
      (projection) => projection.audience === "customer",
    );
    expect(customer).toMatchObject({
      audienceAccountId: accountId,
      commandResource: "core:quotes",
    });
    // Acceptance is absent on purpose: it requires the signatory title and
    // attestation enforced on orders, so it belongs to the acceptance form.
    expect(customer?.payload.allowedActions).toEqual(["expire"]);
  });

  it("grants internal operators the actions the command executor supports", async () => {
    const projections = await projectQuote({
      status: "issued",
      totalMinor: "12500",
      currency: "USD",
    });
    const internal = projections.find(
      (projection) => projection.audience === "internal",
    );
    expect(internal).toMatchObject({ commandResource: "core:quotes" });
    expect(internal?.payload.allowedActions).toEqual([
      "expire",
      "prepare_artifact",
    ]);
  });

  it("grants a named partner the partner-priced artifact action", async () => {
    const projections = await projectQuote({
      status: "issued",
      totalMinor: "12500",
      currency: "USD",
      partnerAccountId,
    });
    const partner = projections.find(
      (projection) => projection.audience === "partner",
    );
    expect(partner).toMatchObject({
      audienceAccountId: partnerAccountId,
      subjectAccountId: accountId,
      channel: "quotes",
      commandResource: "core:quotes",
    });
    expect(partner?.payload.allowedActions).toEqual(["prepare_artifact"]);
  });

  it("withholds a command resource when no action is offered", async () => {
    const projections = await projectQuote({
      status: "expired",
      totalMinor: "12500",
      currency: "USD",
    });
    for (const projection of projections) {
      expect(projection.payload.allowedActions).toEqual([]);
      expect(projection.commandResource).toBeNull();
    }
  });

  it("renders real record content rather than placeholder labels", async () => {
    const projections = await projectQuote({
      status: "issued",
      totalMinor: "1250000",
      currency: "USD",
      revision: 3,
      expiresAt: "2026-08-14T00:00:00.000Z",
      marginFloorResult: "pass",
    });
    const customer = projections.find(
      (projection) => projection.audience === "customer",
    );
    const payload = customer?.payload as Record<string, unknown>;
    expect(payload.value).toBe("$12,500.00");
    expect(payload.valueLabel).toBe("Total USD");
    expect(payload.title).toContain("rev 3");
    expect(payload.kind).toBe("quotes");
    expect(payload.owner).not.toBe("Clockwork");
    expect(payload.term).not.toBe("Authoritative");
    expect(payload.description).not.toBe(
      "Current authoritative commerce state",
    );
    expect(Array.isArray(payload.context)).toBe(true);
  });

  it("binds the payload kind to the channel each audience reads", async () => {
    const projections = await projectQuote({
      status: "issued",
      totalMinor: "12500",
      currency: "USD",
      partnerAccountId,
    });
    for (const projection of projections)
      expect((projection.payload as Record<string, unknown>).kind).toBe(
        projection.channel,
      );
  });
});
