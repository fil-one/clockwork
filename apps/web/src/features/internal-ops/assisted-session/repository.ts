// i18n-exempt-file: database repository. Its Error messages are server-side invariants for logs and audit; Next.js redacts a thrown message before any page renders it, and the error boundary shows a translated message.
import "server-only";

import { sql } from "drizzle-orm";

import {
  hasPermission,
  ids,
  RoleSchema,
  type Role,
} from "@clockwork/contracts";
import {
  appendAuditAndOutbox,
  type RuntimeDatabase,
  type RuntimeTransaction,
  withInternalTransaction,
} from "@clockwork/db";

export interface AssistedSessionView {
  id: string;
  authenticationSessionId: string;
  actualUserId: string;
  actualActorName: string;
  actualActorEmail: string;
  actualRoles: readonly Role[];
  targetAccountId: string;
  targetAccountName: string;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
}

interface AssistedSessionRow extends Record<string, unknown> {
  id: string;
  authentication_session_id: string;
  internal_user_id: string;
  actor_name: string;
  actor_email: string;
  actor_roles: string[];
  target_account_id: string;
  target_account_name: string;
  reason: string;
  started_at: Date | string;
  expires_at: Date | string;
}

interface AssistableAccountRow extends Record<string, unknown> {
  id: string;
  name: string;
}

interface ActorRow extends Record<string, unknown> {
  name: string;
  email: string;
  is_internal_staff: boolean;
  roles: string[];
}

interface IdRow extends Record<string, unknown> {
  id: string;
}

interface EndedSessionRow extends Record<string, unknown> {
  id: string;
  target_account_id: string;
  reason: string;
  expires_at: Date | string;
  actor_email: string;
}

interface EndStateRow extends Record<string, unknown> {
  ended_at: Date | string | null;
}

function timestamp(value: Date | string, field: string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new Error(`Assisted-session ${field} timestamp is invalid`);
  return parsed;
}

function parseRoles(values: readonly string[]): Role[] {
  return values.flatMap((value) => {
    const parsed = RoleSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

function sessionView(row: AssistedSessionRow): AssistedSessionView {
  const actualRoles = parseRoles(row.actor_roles);
  if (!actualRoles.some((role) => hasPermission(role, "impersonation:assume")))
    throw new Error("Actual actor lacks assisted-action permission");
  return {
    id: row.id,
    authenticationSessionId: row.authentication_session_id,
    actualUserId: row.internal_user_id,
    actualActorName: row.actor_name,
    actualActorEmail: row.actor_email,
    actualRoles,
    targetAccountId: row.target_account_id,
    targetAccountName: row.target_account_name,
    reason: row.reason,
    startedAt: timestamp(row.started_at, "started_at"),
    expiresAt: timestamp(row.expires_at, "expires_at"),
  };
}

async function appendAssistedSessionEnd(
  transaction: RuntimeTransaction,
  input: {
    row: EndedSessionRow;
    internalUserId: string;
    requestId: string;
    now: Date;
    eventType:
      "security.assisted_action.ended" | "security.assisted_action.expired";
  },
) {
  await appendAuditAndOutbox(transaction, {
    accountId: input.row.target_account_id,
    aggregateType: "impersonation_session",
    aggregateId: input.row.id,
    aggregateVersion: 2,
    eventType: input.eventType,
    actor: {
      kind: "user",
      id: input.internalUserId,
      display: input.row.actor_email,
      impersonatedAccountId: ids.account.parse(input.row.target_account_id),
      assistedActionReason: input.row.reason,
    },
    requestId: input.requestId,
    before: {
      sessionId: input.row.id,
      targetAccountId: input.row.target_account_id,
      reason: input.row.reason,
      expiresAt: timestamp(input.row.expires_at, "expires_at").toISOString(),
    },
    after: {
      endedAt: input.now.toISOString(),
      outcome:
        input.eventType === "security.assisted_action.expired"
          ? "expired"
          : "exited",
    },
    occurredAt: input.now,
  });
}

export async function resolveAssistedSession(
  db: RuntimeDatabase,
  input: {
    id: string;
    authenticationSessionId: string;
    internalUserId: string;
    requestId: string;
    now?: Date;
  },
): Promise<AssistedSessionView> {
  const now = input.now ?? new Date();
  const resolved = await withInternalTransaction(
    db,
    input.requestId,
    async (transaction) => {
      const rows = await transaction.execute<AssistedSessionRow>(sql`
      select s.id,
             s.authentication_session_id,
             s.internal_user_id,
             s.actor_snapshot_name as actor_name,
             s.actor_snapshot_email as actor_email,
             coalesce(array_agg(distinct m.role) filter (where m.role is not null), '{}') as actor_roles,
             s.target_account_id,
             a.legal_name as target_account_name,
             s.reason,
             s.started_at,
             s.expires_at
      from public.experience_assisted_sessions s
      join public.commerce_users u on u.id = s.internal_user_id
      join public.accounts a on a.id = s.target_account_id
      left join public.memberships m on m.user_id = u.id
      where s.id = ${input.id}::uuid
        and s.authentication_session_id = ${input.authenticationSessionId}
        and s.internal_user_id = ${input.internalUserId}::uuid
        and s.started_at <= ${now.toISOString()}::timestamptz
        and s.expires_at > ${now.toISOString()}::timestamptz
        and s.ended_at is null
        and u.is_internal_staff = true
      group by s.id, u.id, a.id
    `);
      if (rows.length === 1 && rows[0]) return sessionView(rows[0]);
      const expired = await transaction.execute<EndedSessionRow>(sql`
        update public.experience_assisted_sessions
        set ended_at = ${now.toISOString()}::timestamptz
        where id = ${input.id}::uuid
          and authentication_session_id = ${input.authenticationSessionId}
          and internal_user_id = ${input.internalUserId}::uuid
          and ended_at is null
          and expires_at <= ${now.toISOString()}::timestamptz
        returning id, target_account_id, reason, expires_at,
                  actor_snapshot_email as actor_email
      `);
      if (expired[0])
        await appendAssistedSessionEnd(transaction, {
          row: expired[0],
          internalUserId: input.internalUserId,
          requestId: input.requestId,
          now,
          eventType: "security.assisted_action.expired",
        });
      return undefined;
    },
  );
  if (!resolved)
    throw new Error("No active assisted-action authorization exists");
  return resolved;
}

export async function listAssistableAccounts(
  db: RuntimeDatabase,
  input: { requestId: string },
): Promise<{ id: string; name: string }[]> {
  return withInternalTransaction(db, input.requestId, (transaction) =>
    transaction.execute<AssistableAccountRow>(sql`
      select a.id, a.legal_name as name
      from public.accounts a
      where not exists (
        select 1
        from public.organizations o
        join public.memberships m on m.organization_id = o.id
        join public.commerce_users u on u.id = m.user_id
        where o.account_id = a.id and u.is_internal_staff = true
      )
      order by a.legal_name, a.id
    `),
  );
}

/**
 * AuthKit exposes the target user as `session.user` while impersonating. This
 * resolver restores the persisted staff actor and accepts only sessions whose
 * immutable start audit contains the same actor, target, and reason.
 */
export async function resolveProviderAssistedSession(
  db: RuntimeDatabase,
  input: {
    authenticationSessionId: string;
    impersonatorEmail: string;
    targetAccountId: string;
    reason: string;
    requestId: string;
    now?: Date;
  },
): Promise<AssistedSessionView> {
  const reason = input.reason.trim();
  if (reason.length < 8)
    throw new Error("Impersonation requires a meaningful reason");
  const now = input.now ?? new Date();
  return withInternalTransaction(db, input.requestId, async (transaction) => {
    const rows = await transaction.execute<AssistedSessionRow>(sql`
      select s.id,
             ${input.authenticationSessionId}::text as authentication_session_id,
             s.internal_user_id,
             e.actor ->> 'display' as actor_name,
             e.actor ->> 'display' as actor_email,
             coalesce(array_agg(distinct m.role) filter (where m.role is not null), '{}') as actor_roles,
             s.target_account_id,
             a.legal_name as target_account_name,
             s.reason,
             s.started_at,
             s.expires_at
      from public.impersonation_sessions s
      join public.commerce_users u on u.id = s.internal_user_id
      join public.accounts a on a.id = s.target_account_id
      join public.audit_events e
        on e.event_type = 'security.assisted_action.started'
       and e.after ->> 'sessionId' = s.id::text
       and e.actor ->> 'id' = s.internal_user_id::text
       and lower(e.actor ->> 'display') = lower(${input.impersonatorEmail})
      left join public.memberships m on m.user_id = s.internal_user_id
      where lower(u.email) = lower(${input.impersonatorEmail})
        and s.target_account_id = ${input.targetAccountId}::uuid
        and s.reason = ${reason}
        and s.started_at <= ${now.toISOString()}::timestamptz
        and s.expires_at > ${now.toISOString()}::timestamptz
        and s.ended_at is null
        and u.is_internal_staff = true
      group by s.id, a.id, e.id
      limit 2
    `);
    if (rows.length !== 1 || !rows[0])
      throw new Error("No active assisted-action authorization exists");
    return sessionView(rows[0]);
  });
}

export async function endProviderAssistedSession(
  db: RuntimeDatabase,
  input: {
    id: string;
    authenticationSessionId: string;
    internalUserId: string;
    actualActorEmail: string;
    requestId: string;
    now?: Date;
  },
): Promise<"ended" | "already-ended"> {
  const now = input.now ?? new Date();
  return withInternalTransaction(db, input.requestId, async (transaction) => {
    const rows = await transaction.execute<EndedSessionRow>(sql`
      update public.impersonation_sessions s
      set ended_at = ${now.toISOString()}::timestamptz
      from public.audit_events e
      where s.id = ${input.id}::uuid
        and s.internal_user_id = ${input.internalUserId}::uuid
        and s.ended_at is null
        and e.event_type = 'security.assisted_action.started'
        and e.after ->> 'sessionId' = s.id::text
        and e.actor ->> 'id' = s.internal_user_id::text
        and lower(e.actor ->> 'display') = lower(${input.actualActorEmail})
      returning s.id, s.target_account_id, s.reason, s.expires_at,
                e.actor ->> 'display' as actor_email
    `);
    if (rows.length > 1)
      throw new Error("Provider assisted-action evidence is ambiguous");
    const ended = rows[0];
    if (!ended) {
      const existing = await transaction.execute<EndStateRow>(sql`
        select ended_at
        from public.impersonation_sessions
        where id = ${input.id}::uuid
          and internal_user_id = ${input.internalUserId}::uuid
      `);
      if (existing[0]?.ended_at) return "already-ended";
      throw new Error(
        "No provider assisted-action session is authorized for exit",
      );
    }
    await appendAssistedSessionEnd(transaction, {
      row: ended,
      internalUserId: input.internalUserId,
      requestId: input.requestId,
      now,
      eventType: "security.assisted_action.ended",
    });
    return "ended";
  });
}

export async function createAssistedSession(
  db: RuntimeDatabase,
  input: {
    authenticationSessionId: string;
    internalUserId: string;
    targetAccountId: string;
    reason: string;
    requestId: string;
    now?: Date;
    durationMinutes?: number;
  },
): Promise<AssistedSessionView> {
  const reason = input.reason.trim();
  if (reason.length < 8 || reason.length > 500)
    throw new Error("Assisted action requires a meaningful reason");
  const durationMinutes = input.durationMinutes ?? 15;
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 1 ||
    durationMinutes > 15
  )
    throw new Error(
      "Assisted action duration must be between 1 and 15 minutes",
    );
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + durationMinutes * 60_000);
  return withInternalTransaction(db, input.requestId, async (transaction) => {
    const actors = await transaction.execute<ActorRow>(sql`
      select u.name, u.email, u.is_internal_staff,
             coalesce(array_agg(distinct m.role) filter (where m.role is not null), '{}') as roles
      from public.commerce_users u
      left join public.memberships m on m.user_id = u.id
      where u.id = ${input.internalUserId}::uuid
      group by u.id
    `);
    const actor = actors[0];
    const roles = parseRoles(actor?.roles ?? []);
    if (
      !actor?.is_internal_staff ||
      !roles.some((role) => hasPermission(role, "impersonation:assume"))
    )
      throw new Error("Actor lacks assisted-action permission");
    const actorName = actor.name.trim();
    const actorEmail = actor.email.trim().toLowerCase();

    const targets = await transaction.execute<AssistableAccountRow>(sql`
      select a.id, a.legal_name as name
      from public.accounts a
      where a.id = ${input.targetAccountId}::uuid
        and not exists (
          select 1
          from public.organizations o
          join public.memberships m on m.organization_id = o.id
          join public.commerce_users u on u.id = m.user_id
          where o.account_id = a.id and u.is_internal_staff = true
        )
    `);
    const target = targets[0];
    if (!target)
      throw new Error("Assisted action target account is unavailable");

    // Retire expired rows before insertion. The partial unique index is the
    // concurrency backstop when two requests race after this cleanup.
    const retired = await transaction.execute<EndedSessionRow>(sql`
      update public.experience_assisted_sessions
      set ended_at = ${now.toISOString()}::timestamptz
      where internal_user_id = ${input.internalUserId}::uuid
        and authentication_session_id = ${input.authenticationSessionId}
        and ended_at is null
        and expires_at <= ${now.toISOString()}::timestamptz
      returning id, target_account_id, reason, expires_at,
                actor_snapshot_email as actor_email
    `);
    for (const expired of retired)
      await appendAssistedSessionEnd(transaction, {
        row: expired,
        internalUserId: input.internalUserId,
        requestId: `${input.requestId}:expired:${expired.id}`,
        now,
        eventType: "security.assisted_action.expired",
      });
    const existing = await transaction.execute<IdRow>(sql`
      select id
      from public.experience_assisted_sessions
      where internal_user_id = ${input.internalUserId}::uuid
        and authentication_session_id = ${input.authenticationSessionId}
        and ended_at is null
        and expires_at > ${now.toISOString()}::timestamptz
      for update
    `);
    if (existing.length)
      throw new Error("An assisted-action session is already active");

    const inserted = await transaction.execute<AssistedSessionRow>(sql`
      insert into public.experience_assisted_sessions (
        authentication_session_id, internal_user_id,
        actor_snapshot_name, actor_snapshot_email, target_account_id,
        reason, started_at, expires_at, request_id
      ) values (
        ${input.authenticationSessionId}, ${input.internalUserId}::uuid,
        ${actorName}, ${actorEmail},
        ${input.targetAccountId}::uuid, ${reason},
        ${now.toISOString()}::timestamptz, ${expiresAt.toISOString()}::timestamptz,
        ${input.requestId}
      )
      returning id, authentication_session_id, internal_user_id,
                ${actorName}::text as actor_name,
                ${actorEmail}::text as actor_email,
                array(
                  select distinct role
                  from public.memberships
                  where user_id = ${input.internalUserId}::uuid
                  order by role
                )::text[] as actor_roles,
                target_account_id, ${target.name}::text as target_account_name,
                reason, started_at, expires_at
    `);
    const created = inserted[0];
    if (!created) throw new Error("Assisted-action insert failed");
    await appendAuditAndOutbox(transaction, {
      accountId: input.targetAccountId,
      aggregateType: "impersonation_session",
      aggregateId: created.id,
      aggregateVersion: 1,
      eventType: "security.assisted_action.started",
      actor: {
        kind: "user",
        id: input.internalUserId,
        display: actorEmail,
        impersonatedAccountId: ids.account.parse(input.targetAccountId),
        assistedActionReason: reason,
      },
      requestId: input.requestId,
      after: {
        sessionId: created.id,
        targetAccountId: input.targetAccountId,
        reason,
        startedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
      occurredAt: now,
    });
    return sessionView(created);
  });
}

export async function endAssistedSession(
  db: RuntimeDatabase,
  input: {
    id: string;
    authenticationSessionId: string;
    internalUserId: string;
    requestId: string;
    now?: Date;
  },
): Promise<"ended" | "already-ended"> {
  const now = input.now ?? new Date();
  return withInternalTransaction(db, input.requestId, async (transaction) => {
    const rows = await transaction.execute<EndedSessionRow>(sql`
      update public.experience_assisted_sessions s
      set ended_at = ${now.toISOString()}::timestamptz
      from public.commerce_users u
      where s.id = ${input.id}::uuid
        and s.authentication_session_id = ${input.authenticationSessionId}
        and s.internal_user_id = ${input.internalUserId}::uuid
        and s.ended_at is null
        and u.id = s.internal_user_id
        and u.is_internal_staff = true
      returning s.id, s.target_account_id, s.reason, s.expires_at,
                s.actor_snapshot_email as actor_email
    `);
    const ended = rows[0];
    if (!ended) {
      const existing = await transaction.execute<EndStateRow>(sql`
        select ended_at
        from public.experience_assisted_sessions
        where id = ${input.id}::uuid
          and authentication_session_id = ${input.authenticationSessionId}
          and internal_user_id = ${input.internalUserId}::uuid
      `);
      if (existing[0]?.ended_at) return "already-ended";
      throw new Error("No assisted-action session is authorized for exit");
    }
    await appendAssistedSessionEnd(transaction, {
      row: ended,
      internalUserId: input.internalUserId,
      requestId: input.requestId,
      now,
      eventType: "security.assisted_action.ended",
    });
    return "ended";
  });
}
