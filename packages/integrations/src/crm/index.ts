import { createHash } from "node:crypto";

import type { IdempotencyKey, ProviderResult } from "@clockwork/contracts";
import { IdempotencyKeySchema } from "@clockwork/contracts";
import { z } from "zod";

import {
  providerTransportFailure,
  type ProviderJsonTransport,
} from "../provider-transport";

/**
 * The part of a commerce event the projection reads. `EventEnvelope` satisfies
 * it structurally, and so does the outbox delivery payload the dispatcher hands
 * a consumer -- which is what lets the same mapping serve the contract suite and
 * the runtime consumer without either one reconstructing the other's shape.
 */
export interface CrmSourceEvent {
  id: string;
  type: string;
  aggregate: { type: string; id: string; version: number };
  data: Readonly<Record<string, unknown>>;
}

export type CrmObjectType =
  | "account"
  | "contact"
  | "opportunity"
  | "agreement"
  | "order"
  | "renewal"
  | "poc";

export interface CrmProjection {
  projectionId: string;
  sourceEventId: string;
  objectType: CrmObjectType;
  externalKey: string;
  fields: Readonly<Record<string, string | number | boolean | null>>;
  projectedAt: string;
}

export interface CrmProjectionPort {
  project(input: {
    event: CrmSourceEvent;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<CrmProjection>>;
}

export interface CrmProviderClient {
  upsert(input: {
    objectType: CrmObjectType;
    externalKey: string;
    fields: Readonly<Record<string, string | number | boolean | null>>;
    idempotencyKey: string;
  }): Promise<{ providerRecordId: string }>;
}

export class OutboundCrmProjectionAdapter implements CrmProjectionPort {
  public constructor(
    private readonly client: CrmProviderClient,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async project(input: {
    event: CrmSourceEvent;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<CrmProjection>> {
    const projected = mapCommerceEvent(input.event);
    try {
      const response = await this.client.upsert({
        ...projected,
        idempotencyKey: input.idempotencyKey,
      });
      return {
        ok: true,
        value: {
          projectionId: response.providerRecordId,
          sourceEventId: input.event.id,
          ...projected,
          projectedAt: this.now(),
        },
      };
    } catch (error) {
      return providerTransportFailure(error, "CRM_PROVIDER_ERROR");
    }
  }
}

const CrmUpsertResponseSchema = z.object({
  providerRecordId: z.string().min(1).max(255),
});

/**
 * The selected CRM provider boundary. The endpoint and credential are
 * `EXT-PROVIDER-01`; `FetchJsonProviderTransport` refuses to construct without
 * them, so a worker with no approved CRM never reaches this client at all.
 */
export class HttpCrmProviderClient implements CrmProviderClient {
  public constructor(private readonly transport: ProviderJsonTransport) {}

  public upsert(input: {
    objectType: CrmObjectType;
    externalKey: string;
    fields: Readonly<Record<string, string | number | boolean | null>>;
    idempotencyKey: string;
  }): Promise<{ providerRecordId: string }> {
    return this.transport.request({
      operation: "crm.upsert",
      path: "/v1/crm/objects/upsert",
      body: { ...input },
      response: CrmUpsertResponseSchema,
      idempotencyKey: input.idempotencyKey,
    });
  }
}

export class FakeCrmProjectionAdapter implements CrmProjectionPort {
  private readonly projections = new Map<
    string,
    { fingerprint: string; projection: CrmProjection }
  >();
  private nextFailure: "transient" | "permanent" | undefined;

  public readonly writes: CrmProjection[] = [];

  public failNext(kind: "transient" | "permanent"): void {
    this.nextFailure = kind;
  }

  public project(input: {
    event: CrmSourceEvent;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<CrmProjection>> {
    if (this.nextFailure) {
      const kind = this.nextFailure;
      this.nextFailure = undefined;
      return Promise.resolve({
        ok: false,
        kind,
        code: "CRM_SIMULATED_FAILURE",
        message: "Simulated CRM provider failure",
        ...(kind === "transient" ? { retryAfterMs: 1_000 } : {}),
      });
    }
    const mapped = mapCommerceEvent(input.event);
    const fingerprint = hash(JSON.stringify(mapped));
    const prior = this.projections.get(input.idempotencyKey);
    if (prior && prior.fingerprint !== fingerprint)
      return Promise.resolve(
        permanent("IDEMPOTENCY_CONFLICT", "CRM projection key input changed"),
      );
    if (prior)
      return Promise.resolve({
        ok: true,
        value: prior.projection,
        duplicate: true,
      });
    const projection: CrmProjection = {
      projectionId: `crm_fake_${hash(input.idempotencyKey).slice(0, 20)}`,
      sourceEventId: input.event.id,
      ...mapped,
      projectedAt: "2026-07-31T16:00:00.000Z",
    };
    this.projections.set(input.idempotencyKey, { fingerprint, projection });
    this.writes.push(projection);
    return Promise.resolve({ ok: true, value: projection });
  }
}

/**
 * Explicit allow-list: CRM is an outbound pipeline projection, never the
 * commercial source of truth and never receives acceptance evidence or secrets.
 */
export function mapCommerceEvent(event: CrmSourceEvent): {
  objectType: CrmObjectType;
  externalKey: string;
  fields: Readonly<Record<string, string | number | boolean | null>>;
} {
  const objectType = objectTypeFor(event.type);
  const allowedFields = new Set([
    "legalName",
    "country",
    "relationship",
    "stage",
    "status",
    "owner",
    "expectedCloseDate",
    "termEnd",
    "noticeDate",
    "pocExpiry",
    "source",
    "currency",
  ]);
  const fields = Object.fromEntries(
    Object.entries(event.data).filter(
      ([key, value]) =>
        allowedFields.has(key) &&
        (value === null ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"),
    ),
  ) as Record<string, string | number | boolean | null>;
  fields.commerceAggregateVersion = event.aggregate.version;
  fields.commerceEventType = event.type;
  return {
    objectType,
    externalKey: `${event.aggregate.type}:${event.aggregate.id}`,
    fields: Object.freeze(fields),
  };
}

function objectTypeFor(eventType: string): CrmObjectType {
  if (eventType.startsWith("account.")) return "account";
  if (eventType.startsWith("agreement.")) return "agreement";
  // Core finance publishes `core.<resource>.<action>`, so the aggregate the
  // projection is about is the middle segment rather than the leading one.
  if (eventType.startsWith("order.") || eventType.startsWith("core.orders."))
    return "order";
  if (eventType.startsWith("renewal.")) return "renewal";
  if (eventType.startsWith("poc.")) return "poc";
  return "opportunity";
}

/**
 * The commerce topics the outbound projection consumes, one per §15 pipeline
 * moment: registration creates the CRM account, quote issuance and revision
 * carry the opportunity, expiry closes it lost, order creation closes it won,
 * and a renewal request or decline updates the renewal object.
 *
 * This is a routing table, not a catalogue: `createCrmProjectionOutboxHandlers`
 * builds exactly one handler per entry, so an entry with no projection
 * behaviour cannot exist and a projection with no entry is never delivered.
 * Invoice and payment financial state is deliberately absent -- those events
 * bind to the invoice aggregate, and projecting them under an invoice external
 * key would create a second CRM object rather than update the opportunity.
 */
export const crmProjectionTopics = [
  "account.registered",
  "core.quotes.issue",
  "core.quotes.revise",
  "core.quotes.expire",
  "core.orders.create",
  "renewal.requested",
  "renewal.declined",
] as const;

export type CrmProjectionTopic = (typeof crmProjectionTopics)[number];

/**
 * Binds the provider's record identifier to the commerce account row. Commerce
 * stays the customer master: the reference is written once and re-asserted on
 * replay, and a different identifier for the same account is a conflict.
 */
export interface CrmAccountRecordStore {
  bindAccountRecord(input: {
    accountId: string;
    crmRecordId: string;
    requestId: string;
  }): Promise<void>;
}

/** The outbox delivery shape the dispatcher hands a topic handler. */
export interface CrmOutboxDelivery {
  messageId: string;
  eventId: string;
  topic: string;
  payload: unknown;
  idempotencyKey: string;
}

export type CrmOutboxHandler = (delivery: CrmOutboxDelivery) => Promise<void>;

const CrmOutboxPayloadSchema = z
  .object({
    eventId: z.uuid(),
    eventType: z.string().min(1).max(200),
    aggregateType: z.string().min(1).max(100),
    aggregateId: z.uuid(),
    aggregateVersion: z.number().int().positive(),
    data: z.record(z.string(), z.unknown()),
  })
  .passthrough();

/**
 * The runtime consumer of the one-way outbound sync. Delivery is at-least-once,
 * so the projection key is derived from the durable outbox message identifier
 * rather than from the attempt: a redelivery re-presents the same key and the
 * provider adapter answers `duplicate` instead of creating a second record.
 */
export function createCrmProjectionOutboxHandlers(input: {
  projection: CrmProjectionPort;
  accounts: CrmAccountRecordStore;
}): ReadonlyMap<string, CrmOutboxHandler> {
  return new Map(
    crmProjectionTopics.map((topic) => [
      topic,
      async (delivery: CrmOutboxDelivery) => {
        const payload = CrmOutboxPayloadSchema.parse(delivery.payload);
        if (payload.eventType !== topic)
          throw new Error("CRM_PROJECTION_TOPIC_EVENT_MISMATCH");
        const result = await input.projection.project({
          event: {
            id: payload.eventId,
            type: payload.eventType,
            aggregate: {
              type: payload.aggregateType,
              id: payload.aggregateId,
              version: payload.aggregateVersion,
            },
            data: payload.data,
          },
          idempotencyKey: IdempotencyKeySchema.parse(
            `${delivery.idempotencyKey}:crm`,
          ),
        });
        if (!result.ok)
          throw new Error(
            `CRM_PROJECTION_FAILED:${result.kind}:${result.code}`,
          );
        // Only the account aggregate owns `accounts.crm_record_id`. Every other
        // projected object is addressed by its own external key and has no
        // column on the commerce row to bind.
        if (payload.aggregateType !== "account") return;
        await input.accounts.bindAccountRecord({
          accountId: payload.aggregateId,
          crmRecordId: result.value.projectionId,
          requestId: delivery.messageId,
        });
      },
    ]),
  );
}

export class FakeCrmAccountRecordStore implements CrmAccountRecordStore {
  public readonly bound = new Map<string, string>();

  public bindAccountRecord(input: {
    accountId: string;
    crmRecordId: string;
  }): Promise<void> {
    const existing = this.bound.get(input.accountId);
    if (existing !== undefined && existing !== input.crmRecordId)
      return Promise.reject(new Error("CRM_ACCOUNT_RECORD_CONFLICT"));
    this.bound.set(input.accountId, input.crmRecordId);
    return Promise.resolve();
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function permanent(code: string, message: string): ProviderResult<never> {
  return { ok: false, kind: "permanent", code, message };
}
