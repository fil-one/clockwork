import { and, desc, eq, gt, inArray, isNull, sql, type SQL } from "drizzle-orm";

import type { RuntimeDatabase } from "../../client";
import {
  accounts,
  auditEvents,
  commerceUsers,
  impersonationSessions,
} from "../../schema";
import { staffNotices } from "../../schema/access";
import { withInternalTransaction } from "../../transaction";

/**
 * Reads for the owner console, the commerce administrator's overview. Every
 * read runs on the service pool; the page and its actions check
 * `staff:manage` before calling any of them, and notices are always read and
 * marked for the viewer alone.
 */

/** Audit events the console lists as security events. */
export const securityEventTypes = [
  "staff.invited",
  "staff.reactivated",
  "staff.deactivated",
  "staff.role_changed",
  "staff.role_granted",
  "staff.role_revoked",
  "identity.mfa_enrolled",
  "mnda.signer_configured",
  "mnda.settings_changed",
  "mnda.register_exported",
  "workflow.report_exported",
  "security.assisted_action.started",
] as const;
export type SecurityEventType = (typeof securityEventTypes)[number];

export interface ConsoleAuditEvent {
  id: string;
  eventType: string;
  occurredAt: Date;
  /** The staff member who acted, when the actor is a person we know. */
  actor: { userId: string; name: string; email: string } | null;
  /** The account the event belongs to, when it belongs to one. */
  accountName: string | null;
  before: unknown;
  after: unknown;
}

export interface StaffNotice extends ConsoleAuditEvent {
  noticeId: string;
}

export interface OpenAssistedSession {
  id: string;
  staff: { userId: string; name: string; email: string };
  accountId: string;
  accountName: string;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
}

/** The controls whose open requests the console lists. */
export const pendingApprovalControls = [
  "price_book_activation",
  "tax_rule_book_activation",
  "capability_activation",
  "channel_policy",
  "payg_offer",
  "exception_case",
  "termination",
] as const;
export type PendingApprovalControl = (typeof pendingApprovalControls)[number];

/**
 * Exception queues whose cases are decisions (the lifecycle API's
 * `queuePermission`), as opposed to operational work queues.
 */
export const approvalExceptionQueues = [
  "pricing",
  "legal",
  "credit_collections",
  "restricted_parties",
  "disputes",
  "deal_registration_disputes",
  "poc_qualification",
] as const;

/**
 * One request waiting for a second person, from any control. What it is
 * about comes as data (a name, a version, a detail such as a region or a
 * queue) so the page can word it in the reader's language.
 */
export interface PendingApproval {
  control: PendingApprovalControl;
  id: string;
  name: string | null;
  version: number | null;
  detail: string | null;
  requestedBy: { userId: string; name: string; email: string } | null;
  requestedAt: Date;
  /** The portal page the request is decided on; null when it has none. */
  href: string | null;
}

interface PendingApprovalRow extends Record<string, unknown> {
  id: string;
  name: string | null;
  version: number | null;
  detail: string | null;
  requester: string | null;
  requester_name: string | null;
  requester_email: string | null;
  requested_at: Date | string;
  record_key: string | null;
}

/**
 * The open requests of each control, as rows of the same shape: id, name,
 * version, detail, requester, requested_at and record_key.
 */
const pendingApprovalSources: Readonly<Record<PendingApprovalControl, SQL>> = {
  price_book_activation: sql`
    select approval.id, book.name, book.version, null::text as detail,
      approval.requested_by as requester, approval.requested_at,
      null::text as record_key
    from public.approvals approval
    join public.price_books book on book.id = approval.object_id
    where approval.action = 'price_book_activation'
      and approval.status = 'pending'`,
  tax_rule_book_activation: sql`
    select approval.id, book.jurisdiction as name, book.version,
      null::text as detail, approval.requested_by as requester,
      approval.requested_at, null::text as record_key
    from public.approvals approval
    join public.core_tax_rule_books book on book.id = approval.object_id
    where approval.action = 'tax_rule_book_activation'
      and approval.status = 'pending'`,
  // A capability request expires after a day (001423).
  capability_activation: sql`
    select request.id, request.capability_key as name, null::int as version,
      null::text as detail, request.requested_by as requester,
      request.requested_at, null::text as record_key
    from public.system_capability_requests request
    where request.status = 'pending'
      and request.requested_at > now() - interval '24 hours'`,
  channel_policy: sql`
    select policy.id, null::text as name,
      (policy.terms->>'version')::int as version,
      policy.terms->>'effectiveFrom' as detail,
      policy.proposed_by as requester, policy.updated_at as requested_at,
      null::text as record_key
    from public.core_channel_policy_versions policy
    where policy.status = 'proposed'`,
  payg_offer: sql`
    select offer.id, offer.sku as name, offer.version, offer.region as detail,
      offer.proposed_by as requester, offer.updated_at as requested_at,
      null::text as record_key
    from public.core_payg_offer_versions offer
    where offer.status = 'proposed'`,
  exception_case: sql`
    select exception.id, account.legal_name as name, null::int as version,
      exception.queue as detail, exception.requester_user_id as requester,
      exception.created_at as requested_at, (
        select projection.record_key
        from public.experience_portal_projections projection
        where projection.audience = 'internal'
          and projection.channel = 'queues'
          and projection.aggregate_type = 'exception_case'
          and projection.aggregate_id = exception.id
        limit 1
      ) as record_key
    from public.exception_cases exception
    left join public.accounts account on account.id = exception.account_id
    where exception.status = 'open'
      and exception.queue in (${sql.join(
        approvalExceptionQueues.map((queue) => sql`${queue}`),
        sql`, `,
      )})`,
  termination: sql`
    select plan.termination_id as id, account.legal_name as name,
      null::int as version, null::text as detail,
      plan.requested_by as requester, plan.updated_at as requested_at,
      null::text as record_key
    from public.lifecycle_offboarding_plans plan
    join public.accounts account on account.id = plan.account_id
    where plan.plan->>'status' = 'pending_approval'`,
};

/** The portal page each control decides its requests on, when it has one. */
export function pendingApprovalHref(
  control: PendingApprovalControl,
  recordKey: string | null,
): string | null {
  switch (control) {
    case "price_book_activation":
      return "/internal/price-books";
    case "capability_activation":
      return "/internal/capabilities";
    case "channel_policy":
      return "/internal/channel-policy";
    case "payg_offer":
      return "/internal/payg-offers";
    case "exception_case":
      return recordKey
        ? `/internal/queues/${encodeURIComponent(recordKey)}`
        : "/internal/queues";
    // Tax rule books are activated in the database and terminations through
    // the API; neither has a portal page to decide on.
    case "tax_rule_book_activation":
    case "termination":
      return null;
  }
}

const actorColumns = {
  userId: commerceUsers.id,
  name: commerceUsers.name,
  email: commerceUsers.email,
};

// A person actor's id is a commerce user id; system actors match nobody.
const actorJoin = sql`${commerceUsers.id}::text = ${auditEvents.actor}->>'id'`;

function eventView(row: {
  id: string;
  eventType: string;
  occurredAt: Date;
  before: unknown;
  after: unknown;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  accountName: string | null;
}): ConsoleAuditEvent {
  return {
    id: row.id,
    eventType: row.eventType,
    occurredAt: row.occurredAt,
    actor:
      row.actorUserId && row.actorName !== null && row.actorEmail !== null
        ? {
            userId: row.actorUserId,
            name: row.actorName,
            email: row.actorEmail,
          }
        : null,
    accountName: row.accountName,
    before: row.before,
    after: row.after,
  };
}

const eventColumns = {
  id: auditEvents.id,
  eventType: auditEvents.eventType,
  occurredAt: auditEvents.occurredAt,
  before: auditEvents.before,
  after: auditEvents.after,
  actorUserId: actorColumns.userId,
  actorName: actorColumns.name,
  actorEmail: actorColumns.email,
  accountName: accounts.legalName,
};

export class OwnerConsoleRepository {
  public constructor(private readonly database: RuntimeDatabase) {}

  /** The viewer's unread notices, newest first. */
  public unreadNotices(input: {
    viewerUserId: string;
    limit?: number;
    requestId: string;
  }): Promise<StaffNotice[]> {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        const rows = await tx
          .select({ noticeId: staffNotices.id, ...eventColumns })
          .from(staffNotices)
          .innerJoin(auditEvents, eq(auditEvents.id, staffNotices.auditEventId))
          .leftJoin(commerceUsers, actorJoin)
          .leftJoin(accounts, eq(accounts.id, auditEvents.accountId))
          .where(
            and(
              eq(staffNotices.recipientUserId, input.viewerUserId),
              isNull(staffNotices.readAt),
            ),
          )
          .orderBy(desc(staffNotices.createdAt), desc(staffNotices.id))
          .limit(input.limit ?? 50);
        return rows.map((row) => ({
          noticeId: row.noticeId,
          ...eventView(row),
        }));
      },
    );
  }

  /**
   * Marks the viewer's own notices read: the ones named, or all of them.
   * Returns how many changed; someone else's notice never matches.
   */
  public markNoticesRead(input: {
    viewerUserId: string;
    noticeIds: readonly string[] | "all";
    requestId: string;
  }): Promise<number> {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        const updated = await tx
          .update(staffNotices)
          .set({ readAt: new Date() })
          .where(
            and(
              eq(staffNotices.recipientUserId, input.viewerUserId),
              isNull(staffNotices.readAt),
              input.noticeIds === "all"
                ? undefined
                : inArray(staffNotices.id, [...input.noticeIds]),
            ),
          )
          .returning({ id: staffNotices.id });
        return updated.length;
      },
    );
  }

  /** The most recent security events, newest first. */
  public securityEvents(input: {
    eventTypes?: readonly string[];
    limit?: number;
    requestId: string;
  }): Promise<ConsoleAuditEvent[]> {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        const rows = await tx
          .select(eventColumns)
          .from(auditEvents)
          .leftJoin(commerceUsers, actorJoin)
          .leftJoin(accounts, eq(accounts.id, auditEvents.accountId))
          .where(
            inArray(auditEvents.eventType, [
              ...(input.eventTypes ?? securityEventTypes),
            ]),
          )
          .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
          .limit(input.limit ?? 50);
        return rows.map(eventView);
      },
    );
  }

  /**
   * The requests one control has waiting for a decision, oldest first. Read
   * only: each is decided on its own page, by a person other than the one who
   * raised it. Each control is its own read, so the console can show the
   * others when one of them fails.
   */
  public pendingApprovals(input: {
    control: PendingApprovalControl;
    limit?: number;
    requestId: string;
  }): Promise<PendingApproval[]> {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        const rows = await tx.execute<PendingApprovalRow>(sql`
          select pending.*, requester_user.name as requester_name,
            requester_user.email as requester_email
          from (${pendingApprovalSources[input.control]}) pending
          left join public.commerce_users requester_user
            on requester_user.id = pending.requester
          order by pending.requested_at asc, pending.id
          limit ${input.limit ?? 50}
        `);
        return [...rows].map((row) => ({
          control: input.control,
          id: row.id,
          name: row.name,
          version: row.version === null ? null : Number(row.version),
          detail: row.detail,
          requestedBy:
            row.requester && row.requester_name !== null
              ? {
                  userId: row.requester,
                  name: row.requester_name,
                  email: row.requester_email ?? "",
                }
              : null,
          requestedAt: new Date(row.requested_at),
          href: pendingApprovalHref(input.control, row.record_key),
        }));
      },
    );
  }

  /** Assisted sessions that have neither ended nor expired. */
  public openAssistedSessions(input: {
    now: Date;
    requestId: string;
  }): Promise<OpenAssistedSession[]> {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        const rows = await tx
          .select({
            id: impersonationSessions.id,
            userId: commerceUsers.id,
            name: commerceUsers.name,
            email: commerceUsers.email,
            accountId: accounts.id,
            accountName: accounts.legalName,
            reason: impersonationSessions.reason,
            startedAt: impersonationSessions.startedAt,
            expiresAt: impersonationSessions.expiresAt,
          })
          .from(impersonationSessions)
          .innerJoin(
            commerceUsers,
            eq(commerceUsers.id, impersonationSessions.internalUserId),
          )
          .innerJoin(
            accounts,
            eq(accounts.id, impersonationSessions.targetAccountId),
          )
          .where(
            and(
              isNull(impersonationSessions.endedAt),
              gt(impersonationSessions.expiresAt, input.now),
            ),
          )
          .orderBy(desc(impersonationSessions.startedAt));
        return rows.map((row) => ({
          id: row.id,
          staff: { userId: row.userId, name: row.name, email: row.email },
          accountId: row.accountId,
          accountName: row.accountName,
          reason: row.reason,
          startedAt: row.startedAt,
          expiresAt: row.expiresAt,
        }));
      },
    );
  }
}
