import type { Actor } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";

export const coreResourceNames = [
  "accounts",
  "procurement_profiles",
  "price_books",
  "quotes",
  "orders",
  "amendments",
  "commitments",
  "invoices",
  "credit_notes",
  "refunds",
  "disputes",
  "deal_registrations",
  "commissions",
  "accounting_exports",
  "marketplace_reconciliations",
  "reports",
] as const;
export type CoreResourceName = (typeof coreResourceNames)[number];

export const coreReportNames = [
  "revenue_forecast",
  "capacity_planning",
  "renewal_churn_exposure",
  "partner_performance",
  "funnel_cycle_time",
  "margin_poc_cost",
  "three_way_tie_out",
  "weekly_scorecard",
] as const;
export type CoreReportName = (typeof coreReportNames)[number];

export interface CoreRecord {
  id: string;
  resource: CoreResourceName;
  accountId?: string;
  rowVersion: number;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CoreMutation {
  resource: CoreResourceName;
  id: string;
  accountId?: string;
  action: string;
  expectedVersion?: number;
  payload: Record<string, unknown>;
  actor: Actor;
  authorization: AuthorizationContext;
  requestId: string;
  idempotencyKey: string;
  occurredAt: string;
}

export interface CoreMutationResult {
  record: CoreRecord;
  auditEventId: string;
  outboxMessageId: string;
}

export interface CoreListInput {
  resource: CoreResourceName;
  accountId?: string;
  cursor?: string;
  limit: number;
  authorization: AuthorizationContext;
}

export interface CoreFinanceService {
  mutate(input: CoreMutation): Promise<CoreMutationResult>;
  list(
    input: CoreListInput,
  ): Promise<{ items: CoreRecord[]; nextCursor: string | null }>;
  report(input: {
    report: CoreReportName;
    accountId?: string;
    cursor?: string;
    limit: number;
    authorization: AuthorizationContext;
  }): Promise<{ items: CoreRecord[]; nextCursor: string | null }>;
  replay(input: {
    provider: string;
    eventId: string;
    actor: Actor;
    requestId: string;
  }): Promise<{ replayed: boolean; workflowRunId: string }>;
}

const actionsByResource: Record<CoreResourceName, ReadonlySet<string>> = {
  accounts: new Set([
    "create",
    "update",
    "add_role",
    "add_contact",
    "set_payment_terms",
    "set_partner_credit",
  ]),
  procurement_profiles: new Set([
    "create",
    "update",
    "add_certificate",
    "record_supplier_document",
  ]),
  price_books: new Set(["create", "add_rate", "activate", "retire"]),
  quotes: new Set([
    "create",
    "price",
    "approve_exception",
    "reject_exception",
    "prepare_artifact",
    "issue",
    "expire",
    "accept",
    "revise",
  ]),
  orders: new Set([
    "prepare_artifact",
    "create",
    "accept",
    "provision",
    "activate",
    "complete",
    "cancel",
    "terminate",
  ]),
  amendments: new Set(["prepare_artifact", "create", "accept", "apply"]),
  commitments: new Set([
    "create",
    "record_usage",
    "correct_usage",
    "amend_allowance",
    "renew",
    "reconcile",
  ]),
  invoices: new Set([
    "create",
    "issue",
    "open",
    "pay",
    "void",
    "mark_uncollectible",
    "consolidate",
    "evaluate_dunning",
  ]),
  credit_notes: new Set(["issue"]),
  refunds: new Set(["submit"]),
  disputes: new Set(["create"]),
  deal_registrations: new Set([
    "create",
    "approve",
    "reject",
    "expire",
    "extend",
    "dispute",
    "decide_dispute",
    "convert",
  ]),
  commissions: new Set(["accrue", "clawback", "state", "settle"]),
  accounting_exports: new Set(["create", "generate", "post", "reconcile"]),
  marketplace_reconciliations: new Set([
    "create",
    "ingest",
    "reconcile",
    "replay",
  ]),
  reports: new Set(["create", "generate", "complete", "fail"]),
};

export class CoreServiceError extends Error {
  public constructor(
    public readonly code:
      "NOT_FOUND" | "VERSION_CONFLICT" | "DUPLICATE" | "INVALID_STATE",
    message: string,
  ) {
    super(message);
  }
}

function cursorFor(id: string): string {
  return Buffer.from(JSON.stringify({ id }), "utf8").toString("base64url");
}

function cursorId(cursor?: string): string | undefined {
  if (!cursor) return undefined;
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      !value ||
      typeof value !== "object" ||
      !("id" in value) ||
      typeof value.id !== "string"
    )
      throw new Error();
    return value.id;
  } catch {
    throw new CoreServiceError("INVALID_STATE", "Pagination cursor is invalid");
  }
}

/** Deterministic local/test implementation. Production must configure the database-backed service. */
export class MemoryCoreFinanceService implements CoreFinanceService {
  private readonly records = new Map<string, CoreRecord>();
  public readonly auditEvents: Record<string, unknown>[] = [];
  public readonly outboxMessages: Record<string, unknown>[] = [];
  private readonly replays = new Map<string, string>();

  public mutate(input: CoreMutation): Promise<CoreMutationResult> {
    if (!actionsByResource[input.resource].has(input.action))
      throw new CoreServiceError(
        "INVALID_STATE",
        `Action ${input.action} is not valid for ${input.resource}`,
      );
    const key = `${input.resource}:${input.id}`;
    const prior = this.records.get(key);
    if (
      prior?.accountId &&
      input.accountId &&
      prior.accountId !== input.accountId
    )
      throw new CoreServiceError(
        "NOT_FOUND",
        `${input.resource} ${input.id} was not found`,
      );
    if (input.action === "create" && prior)
      throw new CoreServiceError(
        "DUPLICATE",
        `${input.resource} ${input.id} already exists`,
      );
    if (input.action !== "create" && !prior)
      throw new CoreServiceError(
        "NOT_FOUND",
        `${input.resource} ${input.id} was not found`,
      );
    if (prior && input.expectedVersion !== prior.rowVersion)
      throw new CoreServiceError(
        "VERSION_CONFLICT",
        `Expected row version ${input.expectedVersion ?? "missing"}; current version is ${prior.rowVersion}`,
      );
    const record: CoreRecord = {
      id: input.id,
      resource: input.resource,
      ...(input.accountId
        ? { accountId: input.accountId }
        : prior?.accountId
          ? { accountId: prior.accountId }
          : {}),
      rowVersion: (prior?.rowVersion ?? 0) + 1,
      data: {
        ...(prior?.data ?? {}),
        ...input.payload,
        statusAction: input.action,
      },
      createdAt: prior?.createdAt ?? input.occurredAt,
      updatedAt: input.occurredAt,
    };
    const auditEventId = crypto.randomUUID();
    const outboxMessageId = crypto.randomUUID();
    this.records.set(key, record);
    this.auditEvents.push({
      id: auditEventId,
      aggregateType: input.resource,
      aggregateId: input.id,
      aggregateVersion: record.rowVersion,
      eventType: `core.${input.resource}.${input.action}`,
      actor: input.actor,
      requestId: input.requestId,
      before: prior ?? null,
      after: record,
      occurredAt: input.occurredAt,
    });
    this.outboxMessages.push({
      id: outboxMessageId,
      eventId: auditEventId,
      topic: `core.${input.resource}.${input.action}`,
      payload: record,
    });
    return Promise.resolve({ record, auditEventId, outboxMessageId });
  }

  public list(input: CoreListInput) {
    const after = cursorId(input.cursor);
    const eligible = [...this.records.values()]
      .filter(
        (record) =>
          record.resource === input.resource &&
          (input.accountId === undefined ||
            record.accountId === input.accountId),
      )
      .sort((left, right) => left.id.localeCompare(right.id))
      .filter((record) => after === undefined || record.id > after);
    const page = eligible.slice(0, input.limit);
    const finalRecord = page.at(-1);
    return Promise.resolve({
      items: page,
      nextCursor:
        eligible.length > input.limit && finalRecord
          ? cursorFor(finalRecord.id)
          : null,
    });
  }

  public async report(input: {
    report: CoreReportName;
    accountId?: string;
    cursor?: string;
    limit: number;
    authorization: AuthorizationContext;
  }) {
    const page = await this.list({
      resource: "reports",
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      limit: input.limit,
      authorization: input.authorization,
    });
    return {
      ...page,
      items: page.items.filter((record) => record.data.report === input.report),
    };
  }

  public replay(input: {
    provider: string;
    eventId: string;
    actor: Actor;
    requestId: string;
  }) {
    const key = `${input.provider}:${input.eventId}`;
    const prior = this.replays.get(key);
    if (prior)
      return Promise.resolve({ replayed: false, workflowRunId: prior });
    const workflowRunId = crypto.randomUUID();
    this.replays.set(key, workflowRunId);
    return Promise.resolve({ replayed: true, workflowRunId });
  }
}
