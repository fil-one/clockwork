import { describe, expect, it, vi } from "vitest";

import {
  createProjectionMaterializerOutboxHandlers,
  ProjectionMaterializer,
  type AuthoritativeProjectionSourcePort,
  type ProjectionDefinition,
  type ProjectionMaterializerPersistencePort,
} from "./projection-materializer";

const now = new Date("2026-08-01T12:00:00.000Z");
const eventId = "92000000-0000-4000-8000-000000000001";
const aggregateId = "92000000-0000-4000-8000-000000000002";
const accountId = "10000000-0000-4000-8000-000000000001";
const topic = "core.quote.updated";

function delivery(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    messageId: "92000000-0000-4000-8000-000000000003",
    eventId,
    topic,
    payload: {
      eventId,
      eventType: topic,
      aggregateType: "quote",
      aggregateId,
      aggregateVersion: 3,
      occurredAt: now.toISOString(),
      requestId: "projection-materializer-event-0001",
      actor: { kind: "system", id: "quote-workflow" },
      data: { status: "open" },
      ...overrides,
    },
    idempotencyKey: "outbox:projection-materializer-0001",
  };
}

function dependencies(options: {
  sourceVersion?: number;
  payload?: Readonly<Record<string, unknown>>;
  materializeStatus?: "applied" | "duplicate" | "stale";
  emptyProjectionSet?: boolean;
}) {
  const load = vi.fn<AuthoritativeProjectionSourcePort["load"]>(() =>
    Promise.resolve({
      aggregateType: "quote",
      aggregateId,
      accountId,
      version: options.sourceVersion ?? 3,
      sourceHash: "a".repeat(64),
      sourceUpdatedAt: now.toISOString(),
      data: { status: "open", total: "12500" },
    }),
  );
  const materialize = vi.fn<
    ProjectionMaterializerPersistencePort["materialize"]
  >((input) =>
    Promise.resolve({
      status: options.materializeStatus ?? "applied",
      projectionCount: input.projections.length,
    }),
  );
  const definition: ProjectionDefinition = {
    topic,
    eventTypes: [topic],
    aggregateTypes: ["quote"],
    project: () =>
      Promise.resolve(
        options.emptyProjectionSet
          ? []
          : [
              {
                audience: "customer",
                audienceAccountId: accountId,
                subjectAccountId: accountId,
                channel: "quotes",
                recordKey: "Q-0001",
                commandResource: "core:quotes",
                payload: options.payload ?? {
                  id: "Q-0001",
                  status: "open",
                  allowedActions: ["accept_quote"],
                },
              },
              {
                audience: "internal",
                audienceAccountId: null,
                subjectAccountId: accountId,
                channel: "approvals",
                recordKey: "Q-0001",
                commandResource: null,
                payload: {
                  id: "Q-0001",
                  status: "open",
                  allowedActions: [],
                },
              },
            ],
      ),
  };
  return {
    source: { load },
    persistence: { materialize },
    definition,
    spies: { load, materialize },
  };
}

describe("projection materializer", () => {
  it("loads authoritative state and atomically applies scoped read models", async () => {
    const { source, persistence, definition, spies } = dependencies({});
    const materializer = new ProjectionMaterializer(
      source,
      persistence,
      new Map([[topic, definition]]),
      () => now,
    );
    await expect(materializer.handle(delivery())).resolves.toEqual({
      status: "applied",
      projectionCount: 2,
    });
    expect(spies.load).toHaveBeenCalledWith({
      aggregateType: "quote",
      aggregateId,
      minimumVersion: 3,
      requestId: "outbox:projection-materializer-0001",
    });
    const persisted = spies.materialize.mock.calls[0]?.[0];
    if (!persisted) throw new Error("Expected materialization input");
    expect(persisted).toMatchObject({
      eventId,
      aggregateVersion: 3,
      sourceVersion: 3,
      sourceHash: "a".repeat(64),
      sourceUpdatedAt: now.toISOString(),
      projectedAt: now,
    });
    expect(persisted.projections).toHaveLength(2);
    expect(persisted.projections[0]).toMatchObject({
      aggregateType: "quote",
      aggregateId,
      sourceVersion: 3,
      sourceHash: "a".repeat(64),
      commandResource: "core:quotes",
    });
  });

  it("preserves authoritative source identity for an empty projection set", async () => {
    const { source, persistence, definition, spies } = dependencies({
      sourceVersion: 5,
      emptyProjectionSet: true,
    });
    const materializer = new ProjectionMaterializer(
      source,
      persistence,
      new Map([[topic, definition]]),
      () => now,
    );
    await expect(materializer.handle(delivery())).resolves.toEqual({
      status: "applied",
      projectionCount: 0,
    });
    expect(spies.materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceVersion: 5,
        sourceHash: "a".repeat(64),
        sourceUpdatedAt: now.toISOString(),
        projections: [],
      }),
    );
  });

  it("collapses an older event onto a newer authoritative source version", async () => {
    const { source, persistence, definition, spies } = dependencies({
      sourceVersion: 5,
    });
    const materializer = new ProjectionMaterializer(
      source,
      persistence,
      new Map([[topic, definition]]),
      () => now,
    );
    await materializer.handle(delivery());
    const persisted = spies.materialize.mock.calls[0]?.[0];
    expect(persisted?.projections[0]?.sourceVersion).toBe(5);
  });

  it("fails closed when authoritative state is behind the event", async () => {
    const { source, persistence, definition, spies } = dependencies({
      sourceVersion: 2,
    });
    const materializer = new ProjectionMaterializer(
      source,
      persistence,
      new Map([[topic, definition]]),
      () => now,
    );
    await expect(materializer.handle(delivery())).rejects.toThrow(
      "PROJECTION_AUTHORITATIVE_VERSION_BEHIND",
    );
    expect(spies.materialize).not.toHaveBeenCalled();
  });

  it("rejects sensitive projection fields before persistence", async () => {
    const { source, persistence, definition, spies } = dependencies({
      payload: {
        id: "Q-0001",
        accessToken: "must-never-project",
        allowedActions: [],
      },
    });
    const materializer = new ProjectionMaterializer(
      source,
      persistence,
      new Map([[topic, definition]]),
      () => now,
    );
    await expect(materializer.handle(delivery())).rejects.toThrow(
      "PROJECTION_PAYLOAD_SENSITIVE_FIELD_FORBIDDEN",
    );
    expect(spies.materialize).not.toHaveBeenCalled();
  });

  it("rejects an outbox event that is not bound to its topic and aggregate", async () => {
    const { source, persistence, definition, spies } = dependencies({});
    const materializer = new ProjectionMaterializer(
      source,
      persistence,
      new Map([[topic, definition]]),
      () => now,
    );
    await expect(
      materializer.handle(delivery({ aggregateType: "order" })),
    ).rejects.toThrow("PROJECTION_EVENT_BINDING_INVALID");
    expect(spies.load).not.toHaveBeenCalled();
    expect(spies.materialize).not.toHaveBeenCalled();
  });

  it("registers unique authoritative topics and preserves duplicate results", async () => {
    const { source, persistence, definition } = dependencies({
      materializeStatus: "duplicate",
    });
    const handlers = createProjectionMaterializerOutboxHandlers({
      source,
      persistence,
      definitions: [definition],
      clock: () => now,
    });
    expect([...handlers.keys()]).toEqual([topic]);
    const handler = handlers.get(topic);
    if (!handler) throw new Error("Expected projection outbox handler");
    await expect(handler(delivery())).resolves.toBeUndefined();
    expect(() =>
      createProjectionMaterializerOutboxHandlers({
        source,
        persistence,
        definitions: [definition, definition],
      }),
    ).toThrow(`PROJECTION_TOPIC_DUPLICATE:${topic}`);
  });
});
