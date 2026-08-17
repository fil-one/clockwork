import { ActorSchema, type Actor } from "@clockwork/contracts";
import { z } from "zod";

import type { OutboxTopicHandler } from "../system/outbox-dispatcher";

const AuthoritativeOutboxEventSchema = z
  .object({
    eventId: z.uuid(),
    eventType: z.string().regex(/^[a-z][a-z0-9_.-]{1,159}$/),
    aggregateType: z.string().trim().min(1).max(80),
    aggregateId: z.uuid(),
    aggregateVersion: z.number().int().positive(),
    occurredAt: z.iso.datetime({ offset: true }),
    requestId: z.string().min(8).max(128),
    actor: ActorSchema,
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

export type AuthoritativeOutboxEvent = z.infer<
  typeof AuthoritativeOutboxEventSchema
>;

export interface AuthoritativeProjectionState {
  aggregateType: string;
  aggregateId: string;
  accountId: string | null;
  version: number;
  sourceHash: string;
  sourceUpdatedAt: string;
  data: Readonly<Record<string, unknown>>;
}

export type PortalProjectionAudience = "customer" | "partner" | "internal";

export interface PortalProjectionMutation {
  audience: PortalProjectionAudience;
  audienceAccountId: string | null;
  subjectAccountId: string | null;
  channel: string;
  recordKey: string;
  commandResource: string | null;
  payload: Readonly<Record<string, unknown>>;
}

export interface MaterializedPortalProjection extends PortalProjectionMutation {
  aggregateType: string;
  aggregateId: string;
  sourceVersion: number;
  sourceHash: string;
  sourceUpdatedAt: string;
}

export interface AuthoritativeProjectionSourcePort {
  /** Load current authoritative state; projection tables are never a source. */
  load(input: {
    aggregateType: string;
    aggregateId: string;
    minimumVersion: number;
    requestId: string;
  }): Promise<AuthoritativeProjectionState | null>;
}

export interface ProjectionDefinition {
  topic: string;
  eventTypes: readonly string[];
  aggregateTypes: readonly string[];
  /**
   * Reads a canonical aggregate whose type differs from a legacy audit binding.
   * The event aggregate remains checked above; only the authoritative source
   * and resulting projection identity use this explicit override.
   */
  authoritativeAggregateType?: string;
  project(input: {
    event: AuthoritativeOutboxEvent;
    state: AuthoritativeProjectionState;
  }): Promise<readonly PortalProjectionMutation[]>;
}

export interface ProjectionMaterializerPersistencePort {
  /**
   * Atomically deduplicate eventId, upsert every projection only when
   * sourceVersion is not older than the stored source version, and append the
   * materialization audit/outbox evidence. No partial projection set is valid.
   */
  materialize(input: {
    eventId: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    aggregateVersion: number;
    sourceVersion: number;
    sourceHash: string;
    sourceUpdatedAt: string;
    actor: Actor;
    requestId: string;
    projectedAt: Date;
    projections: readonly MaterializedPortalProjection[];
  }): Promise<{
    status: "applied" | "duplicate" | "stale";
    projectionCount: number;
  }>;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^[a-f0-9]{64}$/;
const channelPattern = /^[a-z][a-z0-9_-]{1,63}$/;
const actionPattern = /^[a-z][a-z0-9_]{1,79}$/;
const maximumPayloadBytes = 128 * 1024;
const sensitiveKeys = new Set([
  "accesstoken",
  "authorization",
  "apikey",
  "cookie",
  "credential",
  "password",
  "refreshtoken",
  "secret",
  "sessiontoken",
]);

function validateJsonValue(value: unknown, seen: Set<object>, depth = 0): void {
  if (depth > 16) throw new Error("PROJECTION_PAYLOAD_DEPTH_EXCEEDED");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("PROJECTION_PAYLOAD_NUMBER_INVALID");
    return;
  }
  if (typeof value !== "object")
    throw new Error("PROJECTION_PAYLOAD_VALUE_INVALID");
  if (seen.has(value)) throw new Error("PROJECTION_PAYLOAD_CYCLE_INVALID");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) validateJsonValue(item, seen, depth + 1);
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (sensitiveKeys.has(key.toLowerCase().replaceAll(/[^a-z]/g, "")))
        throw new Error("PROJECTION_PAYLOAD_SENSITIVE_FIELD_FORBIDDEN");
      validateJsonValue(item, seen, depth + 1);
    }
  }
  seen.delete(value);
}

function allowedActions(
  payload: Readonly<Record<string, unknown>>,
): readonly string[] {
  const value = payload.allowedActions;
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some(
      (action) => typeof action !== "string" || !actionPattern.test(action),
    )
  )
    throw new Error("PROJECTION_ALLOWED_ACTIONS_INVALID");
  const actions = value as string[];
  if (new Set(actions).size !== actions.length)
    throw new Error("PROJECTION_ALLOWED_ACTIONS_DUPLICATE");
  return actions;
}

function validateMutation(mutation: PortalProjectionMutation): void {
  if (
    !channelPattern.test(mutation.channel) ||
    mutation.recordKey.length < 1 ||
    mutation.recordKey.length > 160
  )
    throw new Error("PROJECTION_IDENTITY_INVALID");
  if (
    (mutation.audience === "internal" && mutation.audienceAccountId !== null) ||
    (mutation.audience !== "internal" &&
      (!mutation.audienceAccountId ||
        !uuidPattern.test(mutation.audienceAccountId))) ||
    (mutation.subjectAccountId !== null &&
      !uuidPattern.test(mutation.subjectAccountId))
  )
    throw new Error("PROJECTION_AUDIENCE_SCOPE_INVALID");
  const actions = allowedActions(mutation.payload);
  if (actions.length > 0 && !mutation.commandResource?.trim())
    throw new Error("PROJECTION_COMMAND_RESOURCE_REQUIRED");
  if (
    mutation.commandResource !== null &&
    (mutation.commandResource.trim().length < 3 ||
      mutation.commandResource.trim().length > 200)
  )
    throw new Error("PROJECTION_COMMAND_RESOURCE_INVALID");
  validateJsonValue(mutation.payload, new Set());
  const serialized = JSON.stringify(mutation.payload);
  if (Buffer.byteLength(serialized, "utf8") > maximumPayloadBytes)
    throw new Error("PROJECTION_PAYLOAD_TOO_LARGE");
}

function validateState(
  state: AuthoritativeProjectionState,
  event: AuthoritativeOutboxEvent,
  authoritativeAggregateType: string,
): void {
  if (
    state.aggregateType !== authoritativeAggregateType ||
    state.aggregateId !== event.aggregateId
  )
    throw new Error("PROJECTION_AUTHORITATIVE_BINDING_INVALID");
  if (
    !Number.isSafeInteger(state.version) ||
    state.version < event.aggregateVersion
  )
    throw new Error("PROJECTION_AUTHORITATIVE_VERSION_BEHIND");
  if (
    !hashPattern.test(state.sourceHash) ||
    !Number.isFinite(Date.parse(state.sourceUpdatedAt)) ||
    (state.accountId !== null && !uuidPattern.test(state.accountId))
  )
    throw new Error("PROJECTION_AUTHORITATIVE_STATE_INVALID");
  validateJsonValue(state.data, new Set());
}

export class ProjectionMaterializer {
  public constructor(
    private readonly source: AuthoritativeProjectionSourcePort,
    private readonly persistence: ProjectionMaterializerPersistencePort,
    private readonly definitions: ReadonlyMap<string, ProjectionDefinition>,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (definitions.size === 0)
      throw new Error("PROJECTION_DEFINITIONS_NOT_CONFIGURED");
    for (const [topic, definition] of definitions) {
      if (
        topic !== definition.topic ||
        !/^[a-z][a-z0-9_.-]{1,159}$/.test(topic) ||
        definition.eventTypes.length === 0 ||
        definition.aggregateTypes.length === 0
      )
        throw new Error("PROJECTION_DEFINITION_INVALID");
    }
  }

  public async handle(input: {
    messageId: string;
    eventId: string;
    topic: string;
    payload: unknown;
    idempotencyKey: string;
  }): Promise<{
    status: "applied" | "duplicate" | "stale";
    projectionCount: number;
  }> {
    const definition = this.definitions.get(input.topic);
    if (!definition) throw new Error("PROJECTION_TOPIC_NOT_CONFIGURED");
    const event = AuthoritativeOutboxEventSchema.parse(input.payload);
    if (
      event.eventId !== input.eventId ||
      !definition.eventTypes.includes(event.eventType) ||
      !definition.aggregateTypes.includes(event.aggregateType)
    )
      throw new Error("PROJECTION_EVENT_BINDING_INVALID");
    const authoritativeAggregateType =
      definition.authoritativeAggregateType ?? event.aggregateType;
    const state = await this.source.load({
      aggregateType: authoritativeAggregateType,
      aggregateId: event.aggregateId,
      minimumVersion: event.aggregateVersion,
      requestId: input.idempotencyKey,
    });
    if (!state) throw new Error("PROJECTION_AUTHORITATIVE_STATE_NOT_FOUND");
    validateState(state, event, authoritativeAggregateType);
    const mutations = await definition.project({ event, state });
    const identities = new Set<string>();
    const projections = mutations.map((mutation) => {
      validateMutation(mutation);
      const identity = [
        mutation.audience,
        mutation.audienceAccountId ?? "internal",
        mutation.channel,
        mutation.recordKey,
      ].join(":");
      if (identities.has(identity))
        throw new Error("PROJECTION_IDENTITY_DUPLICATE");
      identities.add(identity);
      return {
        ...mutation,
        commandResource: mutation.commandResource?.trim() ?? null,
        aggregateType: state.aggregateType,
        aggregateId: state.aggregateId,
        sourceVersion: state.version,
        sourceHash: state.sourceHash,
        sourceUpdatedAt: state.sourceUpdatedAt,
      } satisfies MaterializedPortalProjection;
    });
    return this.persistence.materialize({
      eventId: event.eventId,
      eventType: event.eventType,
      aggregateType: state.aggregateType,
      aggregateId: event.aggregateId,
      aggregateVersion: event.aggregateVersion,
      sourceVersion: state.version,
      sourceHash: state.sourceHash,
      sourceUpdatedAt: state.sourceUpdatedAt,
      actor: event.actor,
      requestId: input.idempotencyKey,
      projectedAt: this.clock(),
      projections,
    });
  }
}

export function createProjectionMaterializerOutboxHandlers(input: {
  source: AuthoritativeProjectionSourcePort;
  persistence: ProjectionMaterializerPersistencePort;
  definitions: readonly ProjectionDefinition[];
  clock?: () => Date;
}): ReadonlyMap<string, OutboxTopicHandler> {
  const definitions = new Map<string, ProjectionDefinition>();
  for (const definition of input.definitions) {
    if (definitions.has(definition.topic))
      throw new Error(`PROJECTION_TOPIC_DUPLICATE:${definition.topic}`);
    definitions.set(definition.topic, definition);
  }
  const materializer = new ProjectionMaterializer(
    input.source,
    input.persistence,
    definitions,
    input.clock,
  );
  return new Map(
    [...definitions.keys()].map((topic) => [
      topic,
      (delivery: Parameters<OutboxTopicHandler>[0]) =>
        materializer.handle(delivery).then(() => {}),
    ]),
  );
}
