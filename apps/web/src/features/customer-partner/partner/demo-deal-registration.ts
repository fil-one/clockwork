import { currentDemoChannelPolicy } from "@/src/features/internal-ops/commercial-policies/demo-policies";
import "server-only";

import { createHash } from "node:crypto";

import type { SessionClaims } from "@clockwork/api";
import { hasPermission, QuantitySchema, uuidV7 } from "@clockwork/contracts";
import {
  demoText,
  resolveDemoText,
} from "@clockwork/testing/demo-localized-text";
import { demoAccountIds } from "@clockwork/testing/personas";
import type {
  DemoAdapterState,
  DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";
import { z } from "zod";

import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";

import type { RegistrableEndClient } from "./deal-registration-model";
import type { PartnerRecord, PartnerRisk, PartnerStatus } from "./partner-data";
import {
  formatTerabytes,
  partnerMilestoneText,
  partnerPositionText,
  type PartnerReader,
} from "./partner-presentation";

/*
 * Problem `title` and `detail` strings in this file are English API text for
 * logs and API clients. Partner pages never show them; they word the outcome
 * from the problem `code` (partner-command-errors.ts).
 */

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

/**
 * A registration as the demo state store keeps it: facts only. The ledger
 * line, the volume and the protection window are worded when a reader opens
 * the page, in that reader's language.
 *
 * State written before this shape stored `record.context`, `owner`, `value`
 * and `secondary` rendered once in English, and no `expectedVolume` or
 * `protectionDays`. Such a record still reads: its volume is recovered from
 * the old value line and its protection window from the channel policy
 * snapshot it has always carried.
 */
interface StoredRegistration {
  readonly kind: "demo_partner_registration";
  readonly aggregateId: string;
  readonly partnerAccountId: string;
  readonly endClientAccountId: string;
  readonly record: {
    readonly id: string;
    /** "{end client} · {workload}": a name and what the seller typed. */
    readonly name: string;
    readonly status: PartnerStatus;
    readonly risk: PartnerRisk;
  };
  /** Decimal terabytes, as the quantity schema stores them. */
  readonly expectedVolume?: string;
  readonly protectionDays?: number;
  readonly channelPolicySnapshot?: { readonly initialProtectionDays?: number };
  readonly createdAt: string;
}

/** Who decides a registration; stands in for the operator queue's own name. */
const registrationOwner = demoText({
  en: "Fil One channel operations",
  es: "Operaciones de canal de Fil One",
  fr: "Équipe des opérations canal de Fil One",
  de: "Partnermanagement von Fil One",
  ja: "Fil One チャネル運用チーム",
  pt: "Operações de canal da Fil One",
  zh: "Fil One 渠道运营团队",
  ar: "فريق عمليات القنوات في Fil One",
});

function presentRegistration(
  registration: StoredRegistration,
  { t, locale, formatting }: PartnerReader,
): PartnerRecord {
  const { id, name, status, risk } = registration.record;
  const legacyValue = (registration.record as Readonly<Record<string, unknown>>)
    .value;
  const volume =
    registration.expectedVolume ??
    (typeof legacyValue === "string"
      ? /^(\d+(?:\.\d+)?) TB\b/u.exec(legacyValue)?.[1]
      : undefined);
  const days =
    registration.protectionDays ??
    registration.channelPolicySnapshot?.initialProtectionDays;
  return {
    id,
    name,
    status,
    risk,
    owner: resolveDemoText(registrationOwner, locale),
    context:
      volume && days
        ? t("partner.registration.created.context", {
            volume: formatTerabytes(volume, formatting),
            count: days,
          })
        : "",
    value: volume
      ? partnerPositionText(
          { kind: "potentialWorkload", terabytes: volume },
          t,
          formatting,
        )
      : "",
    secondary: partnerMilestoneText(
      { kind: "awaitingChannelDecision" },
      t,
      formatting,
    ),
  };
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
  reader: PartnerReader,
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
    .map((registration) => presentRegistration(registration, reader));
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
      title: "Deal registration refused", // i18n-exempt: API problem title, not rendered
      status,
      detail:
        known || validation
          ? error instanceof Error
            ? error.message
            : "The registration is invalid" // i18n-exempt: API problem detail, not rendered
          : "The demo could not record the deal registration.", // i18n-exempt: API problem detail, not rendered
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
        "Partner quote authority is required", // i18n-exempt: API problem detail, not rendered
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
        "A valid idempotency-key header is required", // i18n-exempt: API problem detail, not rendered
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
        "The registration must belong to the acting partner account", // i18n-exempt: API problem detail, not rendered
      );
    const endClient = demoRegistrableEndClients(partnerAccountId).find(
      (candidate) => candidate.id === command.payload.endClientAccountId,
    );
    if (!endClient)
      throw new RegistrationProblem(
        403,
        "END_CLIENT_SCOPE_FORBIDDEN",
        "The named end client is outside this partner relationship", // i18n-exempt: API problem detail, not rendered
      );
    const now = input.now ?? new Date().toISOString();
    const reference = `REG-DEMO-${command.id.toUpperCase()}`;
    // Facts only; `presentRegistration` words them for each reader.
    const record: StoredRegistration["record"] = {
      id: reference,
      name: `${endClient.name} · ${command.payload.workload}`,
      status: "pending",
      risk: "medium",
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
            "The idempotency key is already bound to another registration", // i18n-exempt: API problem detail, not rendered
          );
        replayed = true;
        result = prior.response;
        return state;
      }
      const channelPolicy = currentDemoChannelPolicy(state, now);
      if (
        channelPolicy.maximumProtectionDays !== null &&
        command.payload.protectionDays > channelPolicy.maximumProtectionDays
      )
        throw new RegistrationProblem(
          422,
          "REGISTRATION_PROTECTION_POLICY_EXCEEDED",
          "Requested protection exceeds the current channel policy maximum", // i18n-exempt: API problem detail, not rendered
        );
      if (state.projectionOverrides[`${registrationPrefix}${command.id}`])
        throw new RegistrationProblem(
          409,
          "REGISTRATION_EXISTS",
          "This deal registration already exists", // i18n-exempt: API problem detail, not rendered
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
              channelPolicySnapshot: {
                ...channelPolicy,
                initialProtectionDays: command.payload.protectionDays,
              },
              aggregateId: command.id,
              partnerAccountId,
              endClientAccountId: endClient.id,
              record,
              expectedVolume: command.payload.expectedVolume,
              protectionDays: command.payload.protectionDays,
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
