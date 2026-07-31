import { createHash } from "node:crypto";

import type {
  EventEnvelope,
  IdempotencyKey,
  ProviderResult,
} from "@clockwork/contracts";

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
    event: EventEnvelope;
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
    event: EventEnvelope;
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
      return transient(error);
    }
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
    event: EventEnvelope;
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
export function mapCommerceEvent(event: EventEnvelope): {
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
  if (eventType.startsWith("order.")) return "order";
  if (eventType.startsWith("renewal.")) return "renewal";
  if (eventType.startsWith("poc.")) return "poc";
  return "opportunity";
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function permanent(code: string, message: string): ProviderResult<never> {
  return { ok: false, kind: "permanent", code, message };
}

function transient(error: unknown): ProviderResult<never> {
  return {
    ok: false,
    kind: "transient",
    code: "CRM_PROVIDER_ERROR",
    message: error instanceof Error ? error.message : "Unknown CRM error",
  };
}
