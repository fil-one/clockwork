import {
  coreReportNames,
  uuidV7,
  type Actor,
  type CoreReportName,
} from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { redactPartnerQuoteData } from "@clockwork/domain/core";

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

// The §17 catalogue, re-exported rather than restated. It used to be a second
// list here, and it had drifted from the one in @clockwork/contracts in both
// directions: this one carried `weekly_scorecard` that one did not have, and
// spelled four reports differently. See the comment on `coreReportNames` there.
export { coreReportNames };
export type { CoreReportName };

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
    reason: string;
    requestId: string;
  }): Promise<{ replayed: boolean; workflowRunId: string }>;
}

/**
 * The commands this API accepts, by resource.
 *
 * Every verb here must reach a branch that can do something. That is not a
 * claim this table can make about itself, and it is not one another table can
 * make for it: P0-59 first shipped as three hand-maintained lists agreeing with
 * each other, which a verb invented in all three satisfied while nothing
 * implemented it. `command-catalogue.integration.test.ts` binds this table to
 * the running repository instead: it invokes every verb here against a real
 * database and requires the answer to be anything other than that resource's
 * refusal of a verb no branch implements. A validation error, a not-found, a
 * version conflict and a success all pass, because all of them prove a branch
 * ran. Only "this resource has no branch for that verb" fails.
 *
 * That file also requires every verb here to be invoked by name or listed as
 * unexercisable with a reason, and the two lists to partition this table
 * exactly, so a verb added here without either fails the suite. That is what
 * covers `accounts`, whose repository code answers an unknown verb the same way
 * it answers `update` -- see the note on that resource in the test.
 *
 * Adding a resource to `coreResourceNames` without classifying it there fails
 * the suite too.
 *
 * Advertising a verb nothing implements is how the portal came to offer "Price"
 * on a draft quote and answer the click with an unsupported-transition error.
 *
 * Deferral is not implementation. `workflowOwnedCoreCommands` records verbs the
 * repository refuses because a workflow owns the transition; those workflows
 * write their rows directly and take no command, so a caller who sends one gets
 * an error every time. They are therefore absent here rather than advertised,
 * with the reason recorded per resource below.
 */
export const coreCommandCatalogue: Record<
  CoreResourceName,
  ReadonlySet<string>
> = {
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
  price_books: new Set([
    "create",
    "clone",
    "import",
    "add_rate",
    "update_rate",
    "remove_rate",
    "update_discount_matrix",
    "reject_activation",
    "request_activation",
    "activate",
    "retire",
  ]),
  // `price` is not a transition: a quote is inserted already priced against the
  // confidential book. `accept` is the order command -- `orders:create` moves
  // the quote to accepted inside the transaction that records the signatory
  // attestation.
  quotes: new Set([
    "create",
    "approve_exception",
    "reject_exception",
    "prepare_artifact",
    "issue",
    "expire",
    "revise",
  ]),
  // Order state is advanced only by the accepted-order transaction,
  // authenticated provider confirmations, or the lifecycle offboarding
  // commands. Keeping generic state verbs here would let an ordinary
  // order:write caller bypass those boundaries.
  orders: new Set(["prepare_artifact", "create"]),
  // Acceptance and application are the immutable create command: it carries the
  // acceptance evidence and writes the amendment money in one transaction.
  amendments: new Set(["prepare_artifact", "create"]),
  commitments: new Set([
    "create",
    "record_usage",
    "correct_usage",
    "amend_allowance",
    "renew",
    "reconcile",
  ]),
  // Invoice status is Stripe's (§10: webhooks are the source of payment truth,
  // no manual entry). Issuance runs through core.billing.issue-invoice.v1,
  // which needs the row to still be a draft with no provider invoice, and
  // open/pay/void/mark_uncollectible arrive on the verified webhook. Local
  // writes of any of them would stop the real issuance and then make the
  // projection refuse the provider's own later truth. End-client allocations
  // are derived when the partner draft is written, so nothing consolidates
  // afterwards.
  invoices: new Set(["create", "evaluate_dunning"]),
  credit_notes: new Set(["issue"]),
  refunds: new Set(["submit"]),
  disputes: new Set(["create"]),
  // `expire` is absent because registration expiry is automatic (§ deal
  // registration: "automatic expiry, explicit extensions, and a dispute
  // path"): protection lapses when `protection_ends_at` passes, and an operator
  // verb would imply someone must press it. `dispute` and `decide_dispute` are
  // absent because the dispute path is unbuilt -- `core_deal_registration_
  // disputes` exists and no code reads or writes it, and the 3-business-day
  // escalation the spec gives it has no owner in code. Extension stays: it is
  // the one registration decision an operator really does take.
  deal_registrations: new Set([
    "create",
    "approve",
    "reject",
    "extend",
    "convert",
  ]),
  // Accrual and clawback are ours -- they are the money. `state` is absent
  // because the commission statement workflow composes statements and writes
  // `commission_statements` itself, and `settle` because payment execution is
  // manual at launch (§ commissions: "Payment execution is manual at launch;
  // the statement nets clawbacks"), so there is nothing for an API verb to do.
  commissions: new Set(["accrue", "clawback"]),
  // The QBO export pipeline owns these rows end to end; the repository
  // implements no accounting-export command at all, so every verb here was an
  // error with a spec reference attached. Reads stay available.
  accounting_exports: new Set([]),
  // Marketplace statements are ingested and reconciled by their own workflow
  // against the provider's file. As above, the repository implements none of
  // it, so nothing may be advertised. Reads stay available.
  marketplace_reconciliations: new Set([]),
  // `create` queues an export. Generation, completion and failure are the
  // scheduled runner's: it claims `report_exports` rows in `pending` and
  // advances them itself, so no caller ever sends those verbs.
  reports: new Set(["create"]),
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
    if (!coreCommandCatalogue[input.resource].has(input.action))
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
    const auditEventId = uuidV7();
    const outboxMessageId = uuidV7();
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
    const page = eligible.slice(0, input.limit).map((record) =>
      record.resource === "quotes"
        ? {
            ...record,
            data: redactPartnerQuoteData(record.data, input.authorization),
          }
        : record,
    );
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
    reason: string;
    requestId: string;
  }) {
    const key = `${input.provider}:${input.eventId}`;
    const prior = this.replays.get(key);
    if (prior)
      return Promise.resolve({ replayed: false, workflowRunId: prior });
    const workflowRunId = uuidV7();
    this.replays.set(key, workflowRunId);
    return Promise.resolve({ replayed: true, workflowRunId });
  }
}
