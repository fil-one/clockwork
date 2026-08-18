import "server-only";

import { createHash } from "node:crypto";

import type { SessionClaims } from "@clockwork/api";
import { hasPermission, QuantitySchema, uuidV7 } from "@clockwork/contracts";
import { demoAccountIds } from "@clockwork/testing/personas";
import type {
  DemoAdapterState,
  DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";
import { z } from "zod";

import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";

import type { RegistrableEndClient } from "./deal-registration-model";
import type { PartnerRecord } from "./partner-data";

const registrationPrefix = "demo-partner-registration:";
const receiptPrefix = "demo-partner-registration-receipt:";

const endClientsByPartner: Readonly<
  Record<string, readonly RegistrableEndClient[]>
> = {
  [demoAccountIds.reseller]: [
    { id: demoAccountIds.resaleEndClient, name: "Aster House Media" },
  ],
  [demoAccountIds.distributor]: [
    { id: demoAccountIds.ukEndClient, name: "Cobalt Orchard GmbH" },
  ],
  [demoAccountIds.referral]: [
    { id: demoAccountIds.endClient, name: "Lumen Field Research" },
  ],
};

const commandSchema = z
  .object({
    id: z.uuid(),
    accountId: z.uuid(),
    action: z.literal("create"),
    payload: z
      .object({
        partnerAccountId: z.uuid(),
        endClientAccountId: z.uuid(),
        workload: z.string().trim().min(1).max(240),
        expectedVolume: QuantitySchema,
        protectionDays: z.number().int().positive().max(730),
      })
      .strict(),
  })
  .strict();

interface StoredRegistration {
  readonly kind: "demo_partner_registration";
  readonly aggregateId: string;
  readonly partnerAccountId: string;
  readonly endClientAccountId: string;
  readonly record: PartnerRecord;
  readonly createdAt: string;
}

interface StoredReceipt {
  readonly kind: "demo_partner_registration_receipt";
  readonly requestHash: string;
  readonly response: Readonly<Record<string, unknown>>;
}

class RegistrationProblem extends Error {
  public constructor(
    public readonly status: 403 | 409 | 422,
    public readonly code: string,
    detail: string,
  ) {
    super(detail);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function storedRegistration(value: unknown): value is StoredRegistration {
  if (!isRecord(value) || value.kind !== "demo_partner_registration")
    return false;
  return (
    typeof value.aggregateId === "string" &&
    typeof value.partnerAccountId === "string" &&
    typeof value.endClientAccountId === "string" &&
    typeof value.createdAt === "string" &&
    isRecord(value.record) &&
    typeof value.record.id === "string"
  );
}

function storedReceipt(value: unknown): value is StoredReceipt {
  return (
    isRecord(value) &&
    value.kind === "demo_partner_registration_receipt" &&
    typeof value.requestHash === "string" &&
    isRecord(value.response)
  );
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function demoRegistrableEndClients(
  partnerAccountId: string,
): readonly RegistrableEndClient[] {
  return structuredClone(endClientsByPartner[partnerAccountId] ?? []);
}

export function demoCreatedRegistrations(
  state: DemoAdapterState,
  partnerAccountId: string,
): readonly PartnerRecord[] {
  return Object.entries(state.projectionOverrides)
    .filter(([key]) => key.startsWith(registrationPrefix))
    .map(([, override]): unknown => override.data)
    .filter(storedRegistration)
    .filter(
      (registration) => registration.partnerAccountId === partnerAccountId,
    )
    .toSorted((left, right) =>
      left.createdAt < right.createdAt
        ? 1
        : left.createdAt > right.createdAt
          ? -1
          : 0,
    )
    .map((registration) => registration.record);
}

function problem(requestId: string, error: unknown): Response {
  const known = error instanceof RegistrationProblem;
  const validation =
    error instanceof z.ZodError || error instanceof SyntaxError;
  const status = known ? error.status : validation ? 422 : 500;
  const code = known
    ? error.code
    : validation
      ? "VALIDATION_FAILED"
      : "DEMO_REGISTRATION_FAILED";
  return Response.json(
    {
      type: `https://clockwork.test/problems/${code.toLowerCase().replaceAll("_", "-")}`,
      title: "Deal registration refused",
      status,
      detail:
        known || validation
          ? error instanceof Error
            ? error.message
            : "The registration is invalid"
          : "The demo could not record the deal registration.",
      code,
      requestId,
      retryable: status >= 500,
    },
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/problem+json",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export async function handleDemoDealRegistrationCommand(
  request: Request,
  session: SessionClaims,
  input: { readonly store?: DemoAdapterStateStore; readonly now?: string } = {},
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? uuidV7();
  try {
    if (
      session.isInternalStaff ||
      !session.roles.some((role) => hasPermission(role, "partner:quote:write"))
    )
      throw new RegistrationProblem(
        403,
        "REGISTRATION_AUTHORITY_FORBIDDEN",
        "Partner quote authority is required",
      );
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (
      !idempotencyKey ||
      idempotencyKey.length < 16 ||
      idempotencyKey.length > 255
    )
      throw new RegistrationProblem(
        422,
        "IDEMPOTENCY_KEY_REQUIRED",
        "A valid idempotency-key header is required",
      );
    const bytes = new Uint8Array(await request.arrayBuffer());
    const requestHash = createHash("sha256")
      .update(request.method)
      .update("\0")
      .update(new URL(request.url).pathname)
      .update("\0")
      .update(bytes)
      .digest("hex");
    const command = commandSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    const partnerAccountId = command.payload.partnerAccountId;
    if (
      command.accountId !== partnerAccountId ||
      !session.accountIds.includes(partnerAccountId)
    )
      throw new RegistrationProblem(
        403,
        "PARTNER_SCOPE_FORBIDDEN",
        "The registration must belong to the acting partner account",
      );
    const endClient = demoRegistrableEndClients(partnerAccountId).find(
      (candidate) => candidate.id === command.payload.endClientAccountId,
    );
    if (!endClient)
      throw new RegistrationProblem(
        403,
        "END_CLIENT_SCOPE_FORBIDDEN",
        "The named end client is outside this partner relationship",
      );
    const now = input.now ?? new Date().toISOString();
    const reference = `REG-DEMO-${command.id.slice(0, 8).toUpperCase()}`;
    const record: PartnerRecord = {
      id: reference,
      name: `${endClient.name} · ${command.payload.workload}`,
      context: `Resale · ${command.payload.expectedVolume} TB · ${command.payload.protectionDays}-day protection requested`,
      status: "pending",
      risk: "medium",
      owner: "Fil One channel operations",
      value: `${command.payload.expectedVolume} TB potential workload`,
      secondary: "Awaiting channel-operations decision",
    };
    const response = {
      record: {
        id: command.id,
        resource: "deal_registrations",
        rowVersion: 1,
        accountId: partnerAccountId,
        data: {
          status: "registered",
          reference,
          partnerAccountId,
          endClientAccountId: endClient.id,
        },
        createdAt: now,
        updatedAt: now,
      },
      auditEventId: uuidV7(),
      outboxMessageId: uuidV7(),
    } as const;
    const store = input.store ?? configuredDemoStateStore();
    let replayed = false;
    let result: Readonly<Record<string, unknown>> = response;
    await store.update((state) => {
      const receiptKey = `${receiptPrefix}${digest(idempotencyKey)}`;
      const prior = state.projectionOverrides[receiptKey]?.data;
      if (storedReceipt(prior)) {
        if (prior.requestHash !== requestHash)
          throw new RegistrationProblem(
            409,
            "IDEMPOTENCY_CONFLICT",
            "The idempotency key is already bound to another registration",
          );
        replayed = true;
        result = prior.response;
        return state;
      }
      if (state.projectionOverrides[`${registrationPrefix}${command.id}`])
        throw new RegistrationProblem(
          409,
          "REGISTRATION_EXISTS",
          "This deal registration already exists",
        );
      return {
        ...state,
        revision: state.revision + 1,
        projectionOverrides: {
          ...state.projectionOverrides,
          [`${registrationPrefix}${command.id}`]: {
            version: 1,
            updatedAt: now,
            data: {
              kind: "demo_partner_registration",
              aggregateId: command.id,
              partnerAccountId,
              endClientAccountId: endClient.id,
              record,
              createdAt: now,
            },
          },
          [receiptKey]: {
            version: 1,
            updatedAt: now,
            data: {
              kind: "demo_partner_registration_receipt",
              requestHash,
              response,
            },
          },
        },
      };
    });
    return Response.json(result, {
      headers: {
        "cache-control": "private, no-store",
        "idempotency-replayed": String(replayed),
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return problem(requestId, error);
  }
}
