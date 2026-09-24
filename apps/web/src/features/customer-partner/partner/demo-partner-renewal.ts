import "server-only";

import { createHash } from "node:crypto";

import type { SessionClaims } from "@clockwork/api";
import { hasPermission, uuidV7 } from "@clockwork/contracts";
import { demoAccountIds } from "@clockwork/testing/personas";
import type {
  DemoAdapterState,
  DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";
import { z } from "zod";

import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";
import {
  demoProjectionRecordId,
  demoProjectionRecordVersion,
} from "@/src/features/experience-server/projection-source";

import type { PartnerRecord, PartnerRisk, PartnerStatus } from "./partner-data";
import {
  partnerMilestoneText,
  readPartnerMilestone,
  type PartnerReader,
} from "./partner-presentation";

/*
 * Problem `title` and `detail` strings in this file are English API text for
 * logs and API clients. Partner pages never show them; the renewal panel says
 * only that nothing changed.
 */

const receiptPrefix = "demo-partner-renewal-receipt:";

const relationships = {
  "demo-partner-renewal-ec-0038": {
    portfolioKey: "EC-0038",
    partnerAccountId: demoAccountIds.reseller,
    endClientAccountId: demoAccountIds.resaleEndClient,
  },
  "demo-partner-renewal-ec-0041": {
    portfolioKey: "EC-0041",
    partnerAccountId: demoAccountIds.referral,
    endClientAccountId: demoAccountIds.endClient,
  },
  "demo-partner-renewal-ec-0047": {
    portfolioKey: "EC-0047",
    partnerAccountId: demoAccountIds.distributor,
    endClientAccountId: demoAccountIds.ukEndClient,
  },
} as const;

type RenewalOrderId = keyof typeof relationships;

const requestSchema = z
  .object({
    accountId: z.uuid(),
    requestedAction: z.enum(["renew", "change_term", "request_change"]),
    requestedTermMonths: z.number().int().positive().nullable(),
  })
  .strict();
const declineSchema = z
  .object({
    accountId: z.uuid(),
    reason: z.string().trim().min(8).max(1_000),
    authorityTitle: z.string().trim().min(2).max(120),
    authorityAttested: z.literal(true),
    evidenceDocumentId: z.string().trim().min(3).max(240),
  })
  .strict();

interface Receipt {
  readonly kind: "demo_partner_renewal_receipt";
  readonly requestHash: string;
  readonly response: Readonly<Record<string, unknown>>;
}

class RenewalProblem extends Error {
  public constructor(
    public readonly status: 403 | 404 | 409 | 422,
    public readonly code: string,
    detail: string,
  ) {
    super(detail);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isReceipt(value: unknown): value is Receipt {
  return (
    isRecord(value) &&
    value.kind === "demo_partner_renewal_receipt" &&
    typeof value.requestHash === "string" &&
    isRecord(value.response)
  );
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function demoPartnerPortfolioRenewalContext(
  portfolioKey: string,
):
  { readonly accountId: string; readonly orderId: RenewalOrderId } | undefined {
  const entry = Object.entries(relationships).find(
    ([, relationship]) => relationship.portfolioKey === portfolioKey,
  );
  return entry
    ? {
        orderId: entry[0] as RenewalOrderId,
        accountId: entry[1].endClientAccountId,
      }
    : undefined;
}

/**
 * The renewals ledger addresses the same end-client relationship as the
 * portfolio, with a `REN-` prefix on its display reference. Keep the hidden
 * order/account binding in one source of truth rather than inventing a second
 * command path for the collection CTA.
 */
export function demoPartnerCollectionRenewalContext(
  renewalKey: string,
): ReturnType<typeof demoPartnerPortfolioRenewalContext> {
  return demoPartnerPortfolioRenewalContext(
    renewalKey.startsWith("REN-") ? renewalKey.slice(4) : renewalKey,
  );
}

function partnerStatus(value: unknown): PartnerStatus | undefined {
  return typeof value === "string" &&
    [
      "active",
      "attention",
      "draft",
      "open",
      "accepted",
      "canceled",
      "pending",
      "paid",
      "blocked",
      "complete",
    ].includes(value)
    ? (value as PartnerStatus)
    : undefined;
}

function partnerRisk(value: unknown): PartnerRisk | undefined {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : undefined;
}

/**
 * Mirrors the durable portfolio decision onto the renewal work ledger. The
 * decision remains stored once, against the authoritative portfolio
 * projection; this is only the read-side view that makes the completed CTA
 * visible after `router.refresh()`.
 */
export function demoPartnerRenewalRecords(
  state: DemoAdapterState,
  partnerAccountId: string,
  records: readonly PartnerRecord[],
  { t, formatting }: Pick<PartnerReader, "t" | "formatting">,
): readonly PartnerRecord[] {
  return records.map((record) => {
    const context = demoPartnerCollectionRenewalContext(
      record.recordKey ?? record.id,
    );
    if (!context) return record;
    const relationship = relationships[context.orderId];
    if (relationship.partnerAccountId !== partnerAccountId) return record;
    const projectionId = demoProjectionRecordId(
      "partner",
      "portfolio",
      relationship.portfolioKey,
    );
    const override = projectionId
      ? state.projectionOverrides[projectionId]
      : undefined;
    if (!override) return record;
    const status = partnerStatus(override.data.status);
    const risk = partnerRisk(override.data.risk);
    // The decision is a fact (`milestone`), worded for this reader. A decision
    // stored before that fact existed carried an English `secondary`; its
    // status says the same thing, so it reads the same way.
    const milestone =
      readPartnerMilestone(override.data.milestone) ??
      (status === "canceled"
        ? { kind: "renewalDeclined" as const }
        : status === "pending"
          ? { kind: "renewalRequested" as const }
          : undefined);
    return {
      ...record,
      ...(status ? { status } : {}),
      ...(risk ? { risk } : {}),
      ...(milestone
        ? { secondary: partnerMilestoneText(milestone, t, formatting) }
        : {}),
      recordVersion: override.version,
      allowedActions: [],
    };
  });
}

export function demoPartnerRenewalOrderId(
  pathname: string,
):
  | { readonly orderId: RenewalOrderId; readonly action: "request" | "decline" }
  | undefined {
  const match =
    /^\/api\/v1\/lifecycle\/renewals\/([^/]+)\/(requests|declines)$/u.exec(
      pathname,
    );
  if (!match?.[1] || !(match[1] in relationships)) return undefined;
  return {
    orderId: match[1] as RenewalOrderId,
    action: match[2] === "declines" ? "decline" : "request",
  };
}

function problem(requestId: string, error: unknown): Response {
  const known = error instanceof RenewalProblem;
  const validation =
    error instanceof z.ZodError || error instanceof SyntaxError;
  const status = known ? error.status : validation ? 422 : 500;
  const code = known
    ? error.code
    : validation
      ? "VALIDATION_FAILED"
      : "DEMO_PARTNER_RENEWAL_FAILED";
  return Response.json(
    {
      type: `https://clockwork.test/problems/${code.toLowerCase().replaceAll("_", "-")}`,
      title: "Renewal decision refused", // i18n-exempt: API problem title, not rendered
      status,
      detail:
        known || validation
          ? error instanceof Error
            ? error.message
            : "The renewal decision is invalid" // i18n-exempt: API problem detail, not rendered
          : "The demo could not record the renewal decision.", // i18n-exempt: API problem detail, not rendered
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

export async function handleDemoPartnerRenewal(
  request: Request,
  session: SessionClaims,
  target: NonNullable<ReturnType<typeof demoPartnerRenewalOrderId>>,
  input: { readonly store?: DemoAdapterStateStore; readonly now?: string } = {},
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? uuidV7();
  try {
    const relationship = relationships[target.orderId];
    if (
      session.isInternalStaff ||
      !session.accountIds.includes(relationship.partnerAccountId) ||
      !session.roles.some((role) => hasPermission(role, "order:write")) ||
      !session.roles.some(
        (role) => role === "partner_admin" || role === "partner_seller",
      )
    )
      throw new RenewalProblem(
        403,
        "PARTNER_RENEWAL_AUTHORITY_FORBIDDEN",
        "Partner order authority is required", // i18n-exempt: API problem detail, not rendered
      );
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (
      !idempotencyKey ||
      idempotencyKey.length < 16 ||
      idempotencyKey.length > 255
    )
      throw new RenewalProblem(
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
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const command =
      target.action === "decline"
        ? declineSchema.parse(parsed)
        : requestSchema.parse(parsed);
    if (command.accountId !== relationship.endClientAccountId)
      throw new RenewalProblem(
        403,
        "PARTNER_RENEWAL_SCOPE_FORBIDDEN",
        "The renewal does not belong to this partner relationship", // i18n-exempt: API problem detail, not rendered
      );
    const projectionId = demoProjectionRecordId(
      "partner",
      "portfolio",
      relationship.portfolioKey,
    );
    const seedVersion = demoProjectionRecordVersion(
      "partner",
      "portfolio",
      relationship.portfolioKey,
    );
    if (!projectionId || !seedVersion)
      throw new RenewalProblem(
        404,
        "PORTFOLIO_NOT_FOUND",
        "The portfolio record is unavailable", // i18n-exempt: API problem detail, not rendered
      );
    const now = input.now ?? new Date().toISOString();
    let result: Readonly<Record<string, unknown>> | undefined;
    let replayed = false;
    await (input.store ?? configuredDemoStateStore()).update((state) => {
      const receiptKey = `${receiptPrefix}${digest(idempotencyKey)}`;
      const prior = state.projectionOverrides[receiptKey]?.data;
      if (isReceipt(prior)) {
        if (prior.requestHash !== requestHash)
          throw new RenewalProblem(
            409,
            "IDEMPOTENCY_CONFLICT",
            "The idempotency key is already bound to another renewal decision", // i18n-exempt: API problem detail, not rendered
          );
        replayed = true;
        result = prior.response;
        return state;
      }
      const priorOverride = state.projectionOverrides[projectionId];
      const nextVersion = (priorOverride?.version ?? seedVersion) + 1;
      const status = target.action === "decline" ? "canceled" : "pending";
      // A fact, worded for each reader by `partnerMilestoneText`.
      const milestone =
        target.action === "decline"
          ? { kind: "renewalDeclined" }
          : { kind: "renewalRequested" };
      result = {
        renewalRequestId: uuidV7(),
        orderId: target.orderId,
        accountId: relationship.endClientAccountId,
        action: target.action,
        status,
        rowVersion: nextVersion,
        updatedAt: now,
      };
      return {
        ...state,
        revision: state.revision + 1,
        projectionOverrides: {
          ...state.projectionOverrides,
          [projectionId]: {
            version: nextVersion,
            updatedAt: now,
            data: {
              ...(priorOverride?.data ?? {}),
              status,
              risk: target.action === "decline" ? "low" : "medium",
              milestone,
            },
          },
          [receiptKey]: {
            version: 1,
            updatedAt: now,
            data: {
              kind: "demo_partner_renewal_receipt",
              requestHash,
              response: result,
            },
          },
        },
      };
    });
    if (!result) throw new Error("Demo renewal produced no result"); // i18n-exempt: internal invariant, not rendered
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
