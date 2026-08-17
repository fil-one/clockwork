import { createHash } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import { withInternalTransaction } from "../../transaction";

export const authoritativeAggregateTypes = [
  "account",
  "agreement",
  "quote",
  "order",
  "amendment",
  "poc",
  "invoice",
  "commission_statement",
  "exception_case",
  "approval",
  "provider_operation",
  "report_export",
  "termination",
] as const;

export type AuthoritativeAggregateType =
  (typeof authoritativeAggregateTypes)[number];

export interface DatabaseAuthoritativeAggregateVersion {
  aggregateType: AuthoritativeAggregateType;
  aggregateId: string;
  accountId: string | null;
  version: number;
}

export interface DatabaseAuthoritativeProjectionState extends DatabaseAuthoritativeAggregateVersion {
  sourceHash: string;
  sourceUpdatedAt: string;
  data: Readonly<Record<string, unknown>>;
}

export type DatabaseAuthoritativeStateErrorCode =
  | "AUTHORITATIVE_AGGREGATE_TYPE_UNKNOWN"
  | "AUTHORITATIVE_AGGREGATE_AMBIGUOUS"
  | "AUTHORITATIVE_AGGREGATE_BINDING_INVALID"
  | "AUTHORITATIVE_AGGREGATE_VERSION_BEHIND"
  | "AUTHORITATIVE_AGGREGATE_PAYLOAD_INVALID";

export class DatabaseAuthoritativeStateError extends Error {
  public constructor(
    public readonly code: DatabaseAuthoritativeStateErrorCode,
  ) {
    super(code);
    this.name = "DatabaseAuthoritativeStateError";
  }
}

const AggregateTypeSchema = z.enum(authoritativeAggregateTypes);
const AggregateIdSchema = z.uuid();
const RequestIdSchema = z.string().min(8).max(255);
const RawAuthoritativeRowSchema = z
  .object({
    aggregate_id: z.uuid(),
    account_id: z.uuid().nullable(),
    aggregate_version: z.number().int().positive(),
    source_updated_at: z.coerce.date(),
    safe_payload: z.record(z.string(), z.unknown()),
  })
  .strict();

type QueryFactory = (aggregateId: string) => SQL;

/**
 * Every payload is an explicit allowlist. Arbitrary JSON, contact/user fields,
 * provider credentials, request keys, and free-form failure text are excluded.
 */
const authoritativeQueries: Record<AuthoritativeAggregateType, QueryFactory> = {
  account: (aggregateId) => sql`
    select a.id as aggregate_id,
           a.id as account_id,
           a.row_version as aggregate_version,
           a.updated_at as source_updated_at,
           jsonb_build_object(
             'relationshipRoles', a.relationship_roles,
             'country', a.country,
             'currency', a.currency,
             'screeningStatus', a.screening_status,
             'parentPartnerId', a.parent_partner_id,
             'partnerAgreementType', a.partner_agreement_type,
             'partnerDiscountTier', a.partner_discount_tier,
             'commissionRateBps', a.commission_rate_bps,
             'commissionHoldbackBps', a.commission_holdback_bps,
             'aggregateCreditLimitMinor', a.aggregate_credit_limit_minor::text
           ) as safe_payload
    from public.accounts a
    where a.id = ${aggregateId}::uuid
    limit 2
  `,
  agreement: (aggregateId) => sql`
    select a.id as aggregate_id,
           a.account_id,
           a.version as aggregate_version,
           a.created_at as source_updated_at,
           jsonb_build_object(
             'paper', a.paper,
             'executionMode', a.execution_mode,
             'negotiationStatus', a.negotiation_status,
             'effectiveOn', a.effective_on::text,
             'termMonths', a.term_months,
             'renewalType', a.renewal_type,
             'noticeDays', a.notice_days,
             'status', a.status,
             'supersededById', a.superseded_by_id,
             'textHash', a.text_hash
           ) as safe_payload
    from public.agreements a
    where a.id = ${aggregateId}::uuid
    limit 2
  `,
  quote: (aggregateId) => sql`
    select q.id as aggregate_id,
           q.account_id,
           q.row_version as aggregate_version,
           q.updated_at as source_updated_at,
           jsonb_build_object(
             'endClientAccountId', q.end_client_account_id,
             'partnerAccountId', q.partner_account_id,
             'priceBookId', q.price_book_id,
             'seriesId', q.series_id,
             'previousRevisionId', q.previous_revision_id,
             'revision', q.revision,
             'status', q.status,
             'currency', q.currency,
             'totalMinor', q.total_minor::text,
             'marginFloorResult', q.margin_floor_result,
             'expiresAt', q.expires_at::text,
             'renderedDocumentId', q.rendered_document_id,
             'partnerDocumentId', q.partner_document_id,
             'partnerResaleTotalMinor', q.partner_resale_total_minor::text,
             'immutableAt', q.immutable_at::text
           ) as safe_payload
    from public.quotes q
    where q.id = ${aggregateId}::uuid
    limit 2
  `,
  order: (aggregateId) => sql`
    select o.id as aggregate_id,
           o.account_id,
           o.row_version as aggregate_version,
           o.updated_at as source_updated_at,
           jsonb_build_object(
             'quoteId', o.quote_id,
             'agreementId', o.agreement_id,
             'invoicingAccountId', o.invoicing_account_id,
             'partnerAccountId', o.partner_account_id,
             'sourcing', o.sourcing,
             'status', o.status,
             'serviceStartsOn', o.service_starts_on::text,
             'serviceEndsOn', o.service_ends_on::text,
             'noticeOn', o.notice_on::text,
             'orderFormDocumentId', o.order_form_document_id,
             'immutableAt', o.immutable_at::text
           ) as safe_payload
    from public.orders o
    where o.id = ${aggregateId}::uuid
    limit 2
  `,
  amendment: (aggregateId) => sql`
    select a.id as aggregate_id,
           o.account_id,
           a.version as aggregate_version,
           a.created_at as source_updated_at,
           jsonb_build_object(
             'orderId', a.order_id,
             'effectiveOn', a.effective_on::text,
             'kind', a.kind,
             'prorationMethod', a.proration_method,
             'documentId', a.document_id
           ) as safe_payload
    from public.amendments a
    join public.orders o on o.id = a.order_id
    where a.id = ${aggregateId}::uuid
    limit 2
  `,
  poc: (aggregateId) => sql`
    select p.id as aggregate_id,
           p.account_id,
           p.row_version as aggregate_version,
           p.updated_at as source_updated_at,
           jsonb_build_object(
             'organizationId', p.organization_id,
             'partnerAccountId', p.partner_account_id,
             'permittedDataClass', p.permitted_data_class,
             'capacityCap', p.capacity_cap::text,
             'egressCap', p.egress_cap::text,
             'durationDays', p.duration_days,
             'expiresAt', p.expires_at::text,
             'kickoffAt', p.kickoff_at::text,
             'midpointAt', p.midpoint_at::text,
             'finalReportAt', p.final_report_at::text,
             'costMinor', p.cost_minor::text,
             'currency', p.currency,
             'engineeringMinutes', p.engineering_minutes,
             'status', p.status,
             'convertedQuoteId', p.converted_quote_id
           ) as safe_payload
    from public.pocs p
    where p.id = ${aggregateId}::uuid
    limit 2
  `,
  invoice: (aggregateId) => sql`
    select i.id as aggregate_id,
           i.account_id,
           i.row_version as aggregate_version,
           i.updated_at as source_updated_at,
           jsonb_build_object(
             'orderId', i.order_id,
             'currency', i.currency,
             'amountMinor', i.amount_minor::text,
             'status', i.status,
             'dueAt', i.due_at::text,
             'paidAt', i.paid_at::text
           ) as safe_payload
    from public.invoices i
    where i.id = ${aggregateId}::uuid
    limit 2
  `,
  commission_statement: (aggregateId) => sql`
    select s.id as aggregate_id,
           s.partner_account_id as account_id,
           s.row_version as aggregate_version,
           s.updated_at as source_updated_at,
           jsonb_build_object(
             'currency', s.currency,
             'grossAccruedMinor', s.gross_accrued_minor::text,
             'clawbackMinor', s.clawback_minor::text,
             'holdbackMinor', s.holdback_minor::text,
             'payableMinor', s.payable_minor::text,
             'periodStartsOn', s.period_starts_on::text,
             'periodEndsOn', s.period_ends_on::text,
             'status', s.status,
             'lineCount', (
               select count(*)::integer
               from public.core_commission_statement_lines l
               where l.statement_id = s.id
             )
           ) as safe_payload
    from public.core_commission_statements s
    where s.id = ${aggregateId}::uuid
    limit 2
  `,
  exception_case: (aggregateId) => sql`
    select e.id as aggregate_id,
           e.account_id,
           e.row_version as aggregate_version,
           e.updated_at as source_updated_at,
           jsonb_build_object(
             'queue', e.queue,
             'objectType', e.object_type,
             'objectId', e.object_id,
             'separationRequired', e.separation_required,
             'ownershipAbsenceEscalated', e.ownership_absence_escalated,
             'targetAt', e.target_at::text,
             'status', e.status
           ) as safe_payload
    from public.exception_cases e
    where e.id = ${aggregateId}::uuid
    limit 2
  `,
  approval: (aggregateId) => sql`
    select a.id as aggregate_id,
           a.account_id,
           a.row_version as aggregate_version,
           a.updated_at as source_updated_at,
           jsonb_build_object(
             'action', a.action,
             'objectType', a.object_type,
             'objectId', a.object_id,
             'status', a.status,
             'requestedAt', a.requested_at::text,
             'decidedAt', a.decided_at::text
           ) as safe_payload
    from public.approvals a
    where a.id = ${aggregateId}::uuid
    limit 2
  `,
  provider_operation: (aggregateId) => sql`
    select p.id as aggregate_id,
           null::uuid as account_id,
           p.row_version as aggregate_version,
           p.updated_at as source_updated_at,
           jsonb_build_object(
             'provider', p.provider,
             'operation', p.operation,
             'aggregateType', p.aggregate_type,
             'aggregateId', p.aggregate_id,
             'status', p.status,
             'attemptCount', p.attempt_count,
             'nextAttemptAt', p.next_attempt_at::text
           ) as safe_payload
    from public.provider_operations p
    where p.id = ${aggregateId}::uuid
    limit 2
  `,
  report_export: (aggregateId) => sql`
    select r.id as aggregate_id,
           null::uuid as account_id,
           r.row_version as aggregate_version,
           r.updated_at as source_updated_at,
           jsonb_build_object(
             'report', r.report,
             'documentId', r.document_id,
             'status', r.status
           ) as safe_payload
    from public.report_exports r
    where r.id = ${aggregateId}::uuid
    limit 2
  `,
  termination: (aggregateId) => sql`
    select t.id as aggregate_id,
           t.account_id,
           t.row_version as aggregate_version,
           t.updated_at as source_updated_at,
           jsonb_build_object(
             'orderId', t.order_id,
             'effectiveAt', t.effective_at::text,
             'finalBillingStatus', t.final_billing_status,
             'teardownStatus', t.teardown_status,
             'deletionScheduledAt', t.deletion_scheduled_at::text,
             'teardownConfirmedAt', t.teardown_confirmed_at::text
           ) as safe_payload
    from public.terminations t
    where t.id = ${aggregateId}::uuid
    limit 2
  `,
};

const typesWithoutRequiredAccount = new Set<AuthoritativeAggregateType>([
  "approval",
  "provider_operation",
  "report_export",
]);
const typesWithNoAccount = new Set<AuthoritativeAggregateType>([
  "provider_operation",
  "report_export",
]);
const forbiddenPayloadKeys = new Set([
  "accesstoken",
  "address",
  "apikey",
  "authorization",
  "contact",
  "cookie",
  "credential",
  "email",
  "idempotencykey",
  "ip",
  "lasterror",
  "name",
  "password",
  "providerreference",
  "refreshtoken",
  "secret",
  "taxid",
  "token",
  "useragent",
]);

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new DatabaseAuthoritativeStateError(
        "AUTHORITATIVE_AGGREGATE_PAYLOAD_INVALID",
      );
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value !== "object")
    throw new DatabaseAuthoritativeStateError(
      "AUTHORITATIVE_AGGREGATE_PAYLOAD_INVALID",
    );
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function assertSafePayload(value: unknown): void {
  if (value === null || ["string", "number", "boolean"].includes(typeof value))
    return;
  if (Array.isArray(value)) {
    for (const item of value) assertSafePayload(item);
    return;
  }
  if (typeof value !== "object")
    throw new DatabaseAuthoritativeStateError(
      "AUTHORITATIVE_AGGREGATE_PAYLOAD_INVALID",
    );
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll(/[^a-z]/g, "");
    if (forbiddenPayloadKeys.has(normalized))
      throw new DatabaseAuthoritativeStateError(
        "AUTHORITATIVE_AGGREGATE_PAYLOAD_INVALID",
      );
    assertSafePayload(item);
  }
}

function sourceHash(input: DatabaseAuthoritativeProjectionState): string {
  const source = canonicalJson({
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    accountId: input.accountId,
    version: input.version,
    sourceUpdatedAt: input.sourceUpdatedAt,
    data: input.data,
  });
  return createHash("sha256").update(source, "utf8").digest("hex");
}

async function selectAuthoritativeRow(
  transaction: RuntimeTransaction,
  aggregateType: AuthoritativeAggregateType,
  aggregateId: string,
) {
  const rows = await transaction.execute(
    authoritativeQueries[aggregateType](aggregateId),
  );
  if (rows.length > 1)
    throw new DatabaseAuthoritativeStateError(
      "AUTHORITATIVE_AGGREGATE_AMBIGUOUS",
    );
  if (!rows[0]) return null;
  const parsed = RawAuthoritativeRowSchema.safeParse(rows[0]);
  if (!parsed.success)
    throw new DatabaseAuthoritativeStateError(
      "AUTHORITATIVE_AGGREGATE_BINDING_INVALID",
    );
  if (
    parsed.data.aggregate_id.toLowerCase() !== aggregateId.toLowerCase() ||
    (aggregateType === "account" &&
      parsed.data.account_id?.toLowerCase() !== aggregateId.toLowerCase()) ||
    (!typesWithoutRequiredAccount.has(aggregateType) &&
      parsed.data.account_id === null) ||
    (typesWithNoAccount.has(aggregateType) && parsed.data.account_id !== null)
  )
    throw new DatabaseAuthoritativeStateError(
      "AUTHORITATIVE_AGGREGATE_BINDING_INVALID",
    );
  assertSafePayload(parsed.data.safe_payload);
  const state: DatabaseAuthoritativeProjectionState = {
    aggregateType,
    aggregateId: parsed.data.aggregate_id,
    accountId: parsed.data.account_id,
    version: parsed.data.aggregate_version,
    sourceHash: "",
    sourceUpdatedAt: parsed.data.source_updated_at.toISOString(),
    data: parsed.data.safe_payload,
  };
  return { ...state, sourceHash: sourceHash(state) };
}

/**
 * Service-role authoritative reads shared by portal command version checks and
 * projection materialization. Unknown types never fall through to dynamic SQL.
 */
export class DatabaseAuthoritativeStateLoader {
  public constructor(private readonly database: RuntimeDatabase) {}

  private read(input: {
    aggregateType: string;
    aggregateId: string;
    requestId: string;
  }): Promise<DatabaseAuthoritativeProjectionState | null> {
    const aggregateType = AggregateTypeSchema.safeParse(input.aggregateType);
    if (!aggregateType.success)
      throw new DatabaseAuthoritativeStateError(
        "AUTHORITATIVE_AGGREGATE_TYPE_UNKNOWN",
      );
    const aggregateId = AggregateIdSchema.parse(input.aggregateId);
    const requestId = RequestIdSchema.parse(input.requestId);
    return withInternalTransaction(this.database, requestId, (transaction) =>
      selectAuthoritativeRow(transaction, aggregateType.data, aggregateId),
    );
  }

  public async loadVersion(input: {
    aggregateType: string;
    aggregateId: string;
    requestId: string;
  }): Promise<DatabaseAuthoritativeAggregateVersion | null> {
    const state = await this.read(input);
    if (!state) return null;
    return {
      aggregateType: state.aggregateType,
      aggregateId: state.aggregateId,
      accountId: state.accountId,
      version: state.version,
    };
  }

  public async load(input: {
    aggregateType: string;
    aggregateId: string;
    minimumVersion: number;
    requestId: string;
  }): Promise<DatabaseAuthoritativeProjectionState | null> {
    const minimumVersion = z
      .number()
      .int()
      .positive()
      .parse(input.minimumVersion);
    const state = await this.read(input);
    if (state && state.version < minimumVersion)
      throw new DatabaseAuthoritativeStateError(
        "AUTHORITATIVE_AGGREGATE_VERSION_BEHIND",
      );
    return state;
  }
}
