import { sql } from "drizzle-orm";
import { z } from "zod";

import {
  ActorSchema,
  privilegedRoles,
  RoleSchema,
  type Actor,
  type Permission,
  type Role,
  type TaxPort,
} from "@clockwork/contracts";
import {
  authorizationActor,
  authorize,
  unscopedInternalOnly,
  type AuthorizationContext,
} from "@clockwork/domain";

import type { RuntimeDatabase } from "../../client";
import { withInternalTransaction } from "../../transaction";
import {
  DatabaseCoreError,
  DatabaseCoreFinanceRepository,
  coreSnapshotHash,
  databaseCoreResourceNames,
  type DatabaseCoreResourceName,
} from "../core";
import {
  DatabaseDeadLetterRecoveryStore,
  DeadLetterRecoveryError,
  deadLetterSources,
  type DeadLetterOperation,
  type DeadLetterSource,
} from "../system/dead-letter";
import { DatabaseAuthoritativeStateLoader } from "./authoritative-state";

const resourceByAggregate = {
  account: "accounts",
  quote: "quotes",
  order: "orders",
  amendment: "amendments",
  invoice: "invoices",
} as const satisfies Readonly<Record<string, DatabaseCoreResourceName>>;

const permissionByResource = {
  accounts: "account:write",
  quotes: "quote:write",
  orders: "order:write",
  amendments: "order:write",
  invoices: "billing:write",
} as const satisfies Readonly<
  Record<
    (typeof resourceByAggregate)[keyof typeof resourceByAggregate],
    Permission
  >
>;

const actionPermissionByResource = {
  quotes: {
    approve_exception: "quote:approve",
    reject_exception: "quote:approve",
  },
  invoices: {
    void: "billing:approve",
    mark_uncollectible: "billing:approve",
    evaluate_dunning: "billing:approve",
  },
} as const satisfies Readonly<
  Partial<
    Record<
      (typeof resourceByAggregate)[keyof typeof resourceByAggregate],
      Readonly<Record<string, Permission>>
    >
  >
>;

function portalCommandPermission(
  resource: (typeof resourceByAggregate)[keyof typeof resourceByAggregate],
  action: string,
  roles: readonly Role[],
): Permission {
  const actionPermission = (
    actionPermissionByResource[
      resource as keyof typeof actionPermissionByResource
    ] as Readonly<Record<string, Permission>> | undefined
  )?.[action];
  if (actionPermission) return actionPermission;
  if (
    resource === "quotes" &&
    roles.some((role) => role === "partner_admin" || role === "partner_seller")
  )
    return "partner:quote:write";
  return permissionByResource[resource];
}

const CoreCommandInputSchema = z
  .object({
    commandResource: z.string().regex(/^core:[a-z_]+$/),
    action: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/),
    aggregateType: z.string().min(1).max(80),
    aggregateId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    payload: z.record(z.string(), z.unknown()),
    actor: ActorSchema,
    effectiveAccountId: z.uuid().nullable(),
    assistedSessionId: z.uuid().nullable(),
    assistedReason: z.string().nullable(),
    mfaVerified: z.boolean(),
    recentAuthenticationVerified: z.boolean(),
    authorizationCreatedAt: z.string().datetime({ offset: true }),
    idempotencyKey: z.string().min(16).max(255),
    requestId: z.string().min(8).max(255),
  })
  .strict();

const IdentityRowSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    is_internal_staff: z.boolean(),
    roles: z.array(RoleSchema),
    account_ids: z.array(z.uuid()),
  })
  .strict();

const AssistedSessionRowSchema = z
  .object({
    id: z.uuid(),
    internal_user_id: z.uuid(),
    target_account_id: z.uuid(),
    reason: z.string().min(8),
    expires_at: z.coerce.date(),
    ended_at: z.coerce.date().nullable(),
  })
  .strict();

const PriorCommandRowSchema = z
  .object({
    request_hash: z.string().regex(/^[a-f0-9]{64}$/),
    response_status: z.number().int().nullable(),
    response_body: z.unknown().nullable(),
    completed_at: z.coerce.date().nullable(),
  })
  .strict();

const PriorCommandResponseSchema = z
  .object({
    record: z
      .object({
        id: z.uuid(),
        rowVersion: z.number().int().positive(),
      })
      .passthrough(),
  })
  .passthrough();

const maximumAuthorizationAgeMs = 5 * 60_000;
const maximumFutureClockSkewMs = 60_000;

export type DatabaseAuthoritativeCommandResult =
  | {
      ok: true;
      aggregateVersion: number;
      resultReference: string;
      replayed: boolean;
    }
  | {
      ok: false;
      code: string;
      resultReference: string;
      authoritativeVersion: number | null;
      disposition: "rejected" | "failed";
      retryable: boolean;
    };

function rejected(
  code: string,
  aggregateId: string,
  version: number | null,
): DatabaseAuthoritativeCommandResult {
  return {
    ok: false,
    code,
    resultReference: `authoritative-command:${aggregateId}:${code.toLowerCase()}`,
    authoritativeVersion: version,
    disposition: "rejected",
    retryable: false,
  };
}

/**
 * Production portal-command bridge. It re-loads current membership and
 * assisted-session truth, then delegates to the same optimistic, idempotent
 * database service used by the authoritative Core API.
 */
export class DatabaseAuthoritativePortalCommandExecutor {
  private readonly states: DatabaseAuthoritativeStateLoader;
  private readonly core: DatabaseCoreFinanceRepository;
  private readonly now: () => Date;

  public constructor(input: {
    database: RuntimeDatabase;
    authorizationSecret: string;
    tax: TaxPort;
    now?: () => Date;
  }) {
    this.states = new DatabaseAuthoritativeStateLoader(input.database);
    this.core = new DatabaseCoreFinanceRepository({
      database: input.database,
      pricingDatabase: input.database,
      authorizationSecret: input.authorizationSecret,
      tax: input.tax,
      ...(input.now ? { now: input.now } : {}),
    });
    this.database = input.database;
    this.now = input.now ?? (() => new Date());
  }

  private readonly database: RuntimeDatabase;

  private async currentAuthorization(input: {
    actorUserId: string;
    effectiveAccountId: string | null;
    assistedSessionId: string | null;
    assistedReason: string | null;
    mfaVerified: boolean;
    recentAuthenticationVerified: boolean;
    requestId: string;
  }): Promise<AuthorizationContext | null> {
    return withInternalTransaction(
      this.database,
      `${input.requestId}:authorization`,
      async (transaction) => {
        const identityRows = await transaction.execute(sql`
          select app_user.id, app_user.email, app_user.is_internal_staff,
                 coalesce(
                   jsonb_agg(distinct membership.role)
                     filter (
                       where membership.role is not null
                         and (
                           app_user.is_internal_staff
                           or organization.account_id = ${input.effectiveAccountId}::uuid
                         )
                     ),
                   '[]'::jsonb
                 ) as roles,
                 coalesce(
                   jsonb_agg(distinct organization.account_id)
                     filter (where organization.account_id is not null),
                   '[]'::jsonb
                 ) as account_ids
          from public.commerce_users app_user
          left join public.memberships membership
            on membership.user_id = app_user.id
          left join public.organizations organization
            on organization.id = membership.organization_id
          where app_user.id = ${input.actorUserId}::uuid
          group by app_user.id, app_user.email, app_user.is_internal_staff
        `);
        const identity = IdentityRowSchema.safeParse(identityRows[0]);
        if (!identity.success || identity.data.roles.length === 0) return null;

        const roles = [...new Set(identity.data.roles)] as Role[];
        if (
          !input.recentAuthenticationVerified ||
          (roles.some((role) =>
            privilegedRoles.includes(role as (typeof privilegedRoles)[number]),
          ) &&
            !input.mfaVerified)
        )
          return null;
        const effectiveAccountId = input.effectiveAccountId;
        if (!identity.data.is_internal_staff) {
          if (
            input.assistedSessionId !== null ||
            input.assistedReason !== null ||
            !effectiveAccountId ||
            !identity.data.account_ids.includes(effectiveAccountId)
          )
            return null;
          return {
            userId: identity.data.id as AuthorizationContext["userId"],
            accountIds: [
              effectiveAccountId as AuthorizationContext["accountIds"][number],
            ],
            roles,
            isInternalStaff: false,
            mfaVerified: input.mfaVerified,
            recentAuthenticationVerified: input.recentAuthenticationVerified,
          };
        }

        if (
          !effectiveAccountId ||
          !input.assistedSessionId ||
          !input.assistedReason
        )
          return null;
        const assistedRows = await transaction.execute(sql`
          select id, internal_user_id, target_account_id, reason,
                 expires_at, ended_at
          from public.experience_assisted_sessions
          where id = ${input.assistedSessionId}::uuid
          for share
        `);
        const assisted = AssistedSessionRowSchema.safeParse(assistedRows[0]);
        if (
          !assisted.success ||
          assisted.data.internal_user_id !== identity.data.id ||
          assisted.data.target_account_id !== effectiveAccountId ||
          assisted.data.reason !== input.assistedReason ||
          assisted.data.ended_at !== null ||
          assisted.data.expires_at <= this.now()
        )
          return null;
        return {
          userId: identity.data.id as AuthorizationContext["userId"],
          accountIds: [
            effectiveAccountId as AuthorizationContext["accountIds"][number],
          ],
          roles,
          isInternalStaff: true,
          mfaVerified: input.mfaVerified,
          recentAuthenticationVerified: input.recentAuthenticationVerified,
          impersonation: {
            accountId:
              effectiveAccountId as AuthorizationContext["accountIds"][number],
            reason: assisted.data.reason,
            sessionId: assisted.data.id,
            actualUserId: identity.data.id as AuthorizationContext["userId"],
            actualActorEmail: identity.data.email,
          },
        };
      },
    );
  }

  private inspectPriorCommand(input: {
    ownerUserId: string;
    resource: DatabaseCoreResourceName;
    idempotencyKey: string;
    requestHash: string;
    aggregateId: string;
    requestId: string;
  }): Promise<
    | { kind: "none" }
    | { kind: "in_progress" }
    | { kind: "conflict" }
    | { kind: "invalid" }
    | { kind: "replay"; aggregateVersion: number }
  > {
    return withInternalTransaction(
      this.database,
      `${input.requestId}:replay-check`,
      async (transaction) => {
        const rows = await transaction.execute(sql`
          select request_hash, response_status, response_body, completed_at
          from public.lifecycle_idempotency_records
          where owner_user_id = ${input.ownerUserId}::uuid
            and scope = ${`core:${input.resource}`}
            and key = ${input.idempotencyKey}
        `);
        if (rows.length === 0) return { kind: "none" } as const;
        const row = PriorCommandRowSchema.safeParse(rows[0]);
        if (!row.success) return { kind: "invalid" } as const;
        if (row.data.request_hash !== input.requestHash)
          return { kind: "conflict" } as const;
        if (
          row.data.completed_at === null ||
          row.data.response_status === null ||
          row.data.response_body === null
        )
          return { kind: "in_progress" } as const;
        if (row.data.response_status !== 200)
          return { kind: "invalid" } as const;
        const response = PriorCommandResponseSchema.safeParse(
          row.data.response_body,
        );
        if (!response.success || response.data.record.id !== input.aggregateId)
          return { kind: "invalid" } as const;
        return {
          kind: "replay",
          aggregateVersion: response.data.record.rowVersion,
        } as const;
      },
    );
  }

  public async execute(input: {
    commandResource: string;
    action: string;
    aggregateType: string;
    aggregateId: string;
    expectedVersion: number;
    payload: Readonly<Record<string, unknown>>;
    actor: Actor;
    effectiveAccountId: string | null;
    assistedSessionId: string | null;
    assistedReason: string | null;
    mfaVerified: boolean;
    recentAuthenticationVerified: boolean;
    authorizationCreatedAt: string;
    idempotencyKey: string;
    requestId: string;
  }): Promise<DatabaseAuthoritativeCommandResult> {
    const parsed = CoreCommandInputSchema.safeParse(input);
    if (!parsed.success || parsed.data.actor.kind !== "user")
      return rejected("AUTHORITATIVE_COMMAND_INVALID", input.aggregateId, null);
    const resource =
      resourceByAggregate[
        parsed.data.aggregateType as keyof typeof resourceByAggregate
      ];
    if (
      !resource ||
      !databaseCoreResourceNames.includes(resource) ||
      parsed.data.commandResource !== `core:${resource}`
    )
      return rejected(
        "AUTHORITATIVE_COMMAND_BINDING_INVALID",
        parsed.data.aggregateId,
        null,
      );
    const requestHash = coreSnapshotHash({
      resource,
      id: parsed.data.aggregateId,
      accountId: parsed.data.effectiveAccountId,
      action: parsed.data.action,
      expectedVersion: parsed.data.expectedVersion,
      payload: parsed.data.payload,
    });
    const prior = await this.inspectPriorCommand({
      ownerUserId: parsed.data.actor.id,
      resource,
      idempotencyKey: parsed.data.idempotencyKey,
      requestHash,
      aggregateId: parsed.data.aggregateId,
      requestId: parsed.data.requestId,
    });
    if (prior.kind === "replay")
      return {
        ok: true,
        aggregateVersion: prior.aggregateVersion,
        resultReference: `core:${resource}:${parsed.data.aggregateId}:version:${prior.aggregateVersion}`,
        replayed: true,
      };
    if (prior.kind === "conflict")
      return rejected(
        "AUTHORITATIVE_IDEMPOTENCY_CONFLICT",
        parsed.data.aggregateId,
        null,
      );
    if (prior.kind === "invalid")
      return {
        ok: false,
        code: "AUTHORITATIVE_REPLAY_EVIDENCE_INVALID",
        resultReference: `authoritative-command:${parsed.data.aggregateId}:replay-evidence-invalid`,
        authoritativeVersion: null,
        disposition: "failed",
        retryable: false,
      };
    if (prior.kind === "in_progress")
      return {
        ok: false,
        code: "AUTHORITATIVE_COMMAND_IN_PROGRESS",
        resultReference: `authoritative-command:${parsed.data.aggregateId}:in-progress`,
        authoritativeVersion: null,
        disposition: "failed",
        retryable: true,
      };
    const authorizationCreatedAt = Date.parse(
      parsed.data.authorizationCreatedAt,
    );
    const authorizationAgeMs = this.now().getTime() - authorizationCreatedAt;
    if (
      !Number.isFinite(authorizationCreatedAt) ||
      authorizationAgeMs > maximumAuthorizationAgeMs ||
      authorizationAgeMs < -maximumFutureClockSkewMs
    )
      return rejected(
        "PORTAL_ACTION_AUTHORIZATION_EXPIRED",
        parsed.data.aggregateId,
        null,
      );
    const state = await this.states.loadVersion({
      aggregateType: parsed.data.aggregateType,
      aggregateId: parsed.data.aggregateId,
      requestId: `${parsed.data.requestId}:state`,
    });
    if (!state)
      return rejected(
        "AUTHORITATIVE_AGGREGATE_NOT_FOUND",
        parsed.data.aggregateId,
        null,
      );
    if (state.version !== parsed.data.expectedVersion)
      return rejected(
        "AUTHORITATIVE_VERSION_CONFLICT",
        parsed.data.aggregateId,
        state.version,
      );
    if (!state.accountId || state.accountId !== parsed.data.effectiveAccountId)
      return rejected(
        "AUTHORITATIVE_ACCOUNT_SCOPE_INVALID",
        parsed.data.aggregateId,
        state.version,
      );
    const authorization = await this.currentAuthorization({
      actorUserId: parsed.data.actor.id,
      effectiveAccountId: parsed.data.effectiveAccountId,
      assistedSessionId: parsed.data.assistedSessionId,
      assistedReason: parsed.data.assistedReason,
      mfaVerified: parsed.data.mfaVerified,
      recentAuthenticationVerified: parsed.data.recentAuthenticationVerified,
      requestId: parsed.data.requestId,
    });
    if (!authorization)
      return rejected(
        "AUTHORITATIVE_AUTHORIZATION_REVOKED",
        parsed.data.aggregateId,
        state.version,
      );
    const permission = portalCommandPermission(
      resource,
      parsed.data.action,
      authorization.roles,
    );
    try {
      authorize(
        authorization,
        permission,
        state.accountId as AuthorizationContext["accountIds"][number],
      );
    } catch {
      return rejected(
        "AUTHORITATIVE_PERMISSION_REVOKED",
        parsed.data.aggregateId,
        state.version,
      );
    }
    try {
      const execution = await this.core.mutateWithReplay({
        resource,
        id: parsed.data.aggregateId,
        accountId: state.accountId,
        action: parsed.data.action,
        expectedVersion: parsed.data.expectedVersion,
        payload: parsed.data.payload,
        actor: authorizationActor(authorization),
        authorization,
        requestId: parsed.data.requestId,
        idempotencyKey: parsed.data.idempotencyKey,
        occurredAt: this.now().toISOString(),
      });
      return {
        ok: true,
        aggregateVersion: execution.result.record.rowVersion,
        resultReference: `core:${resource}:${execution.result.record.id}:version:${execution.result.record.rowVersion}`,
        replayed: execution.replayed,
      };
    } catch (error) {
      if (error instanceof DatabaseCoreError) {
        if (error.code === "VERSION_CONFLICT")
          return rejected(
            "AUTHORITATIVE_VERSION_CONFLICT",
            parsed.data.aggregateId,
            state.version,
          );
        if (error.code === "NOT_FOUND")
          return rejected(
            "AUTHORITATIVE_AGGREGATE_NOT_FOUND",
            parsed.data.aggregateId,
            null,
          );
        return {
          ok: false,
          code:
            error.code === "DUPLICATE"
              ? "AUTHORITATIVE_IDEMPOTENCY_CONFLICT"
              : "AUTHORITATIVE_COMMAND_REJECTED",
          resultReference: `authoritative-command:${parsed.data.aggregateId}:rejected`,
          authoritativeVersion: state.version,
          disposition: "rejected",
          retryable:
            error.code === "DUPLICATE" && /in progress/i.test(error.message),
        };
      }
      throw error;
    }
  }
}

const SystemRecoveryInputSchema = z
  .object({
    action: z.enum(["retry", "abandon"]),
    source: z.enum(deadLetterSources),
    id: z.uuid(),
    reason: z.string().trim().min(8).max(500),
    actor: ActorSchema,
    mfaVerified: z.boolean(),
    recentAuthenticationVerified: z.boolean(),
    authorizationCreatedAt: z.iso.datetime({ offset: true }),
    idempotencyKey: z.string().min(16).max(255),
    requestId: z.string().min(8).max(255),
  })
  .strict();

export type DatabaseSystemRecoveryResult =
  | { ok: true; operation: DeadLetterOperation; replayed: boolean }
  | { ok: false; code: string; retryable: boolean };

/**
 * Operator recovery for work that has stopped.
 *
 * Stopped work is system-scoped: an outbox message may carry no account, a
 * workflow run has none at all, and no assisted session can stand in for one.
 * So this reloads internal-staff identity and checks `system:operate` without
 * an account binding, rather than reusing the account-scoped portal path above.
 * Everything else is the same contract: freshly re-read roles, recent
 * authentication, a reason long enough to be evidence, one idempotency record
 * per decision, and an audit event written with the state change.
 */
export class DatabaseSystemRecoveryCommandExecutor {
  private readonly recovery: DatabaseDeadLetterRecoveryStore;
  private readonly now: () => Date;

  public constructor(input: { database: RuntimeDatabase; now?: () => Date }) {
    this.database = input.database;
    this.now = input.now ?? (() => new Date());
    this.recovery = new DatabaseDeadLetterRecoveryStore(
      input.database,
      this.now,
    );
  }

  private readonly database: RuntimeDatabase;

  private internalAuthorization(input: {
    actorUserId: string;
    mfaVerified: boolean;
    recentAuthenticationVerified: boolean;
    requestId: string;
  }): Promise<AuthorizationContext | null> {
    return withInternalTransaction(
      this.database,
      `${input.requestId}:authorization`,
      async (transaction) => {
        const rows = await transaction.execute(sql`
          select app_user.id, app_user.email, app_user.is_internal_staff,
                 coalesce(
                   jsonb_agg(distinct membership.role)
                     filter (where membership.role is not null),
                   '[]'::jsonb
                 ) as roles,
                 '[]'::jsonb as account_ids
          from public.commerce_users app_user
          left join public.memberships membership
            on membership.user_id = app_user.id
          where app_user.id = ${input.actorUserId}::uuid
          group by app_user.id, app_user.email, app_user.is_internal_staff
        `);
        const identity = IdentityRowSchema.safeParse(rows[0]);
        if (
          !identity.success ||
          !identity.data.is_internal_staff ||
          identity.data.roles.length === 0 ||
          !input.recentAuthenticationVerified
        )
          return null;
        const roles = [...new Set(identity.data.roles)] as Role[];
        if (
          roles.some((role) =>
            privilegedRoles.includes(role as (typeof privilegedRoles)[number]),
          ) &&
          !input.mfaVerified
        )
          return null;
        return {
          userId: identity.data.id as AuthorizationContext["userId"],
          accountIds: [],
          roles,
          isInternalStaff: true,
          mfaVerified: input.mfaVerified,
          recentAuthenticationVerified: input.recentAuthenticationVerified,
        };
      },
    );
  }

  public async execute(input: {
    action: "retry" | "abandon";
    source: DeadLetterSource;
    id: string;
    reason: string;
    actor: Actor;
    mfaVerified: boolean;
    recentAuthenticationVerified: boolean;
    authorizationCreatedAt: string;
    idempotencyKey: string;
    requestId: string;
  }): Promise<DatabaseSystemRecoveryResult> {
    const parsed = SystemRecoveryInputSchema.safeParse(input);
    if (!parsed.success || parsed.data.actor.kind !== "user")
      return { ok: false, code: "SYSTEM_RECOVERY_INVALID", retryable: false };
    const authorizationCreatedAt = Date.parse(
      parsed.data.authorizationCreatedAt,
    );
    const ageMs = this.now().getTime() - authorizationCreatedAt;
    if (
      !Number.isFinite(authorizationCreatedAt) ||
      ageMs > maximumAuthorizationAgeMs ||
      ageMs < -maximumFutureClockSkewMs
    )
      return {
        ok: false,
        code: "SYSTEM_RECOVERY_AUTHORIZATION_EXPIRED",
        retryable: false,
      };
    const authorization = await this.internalAuthorization({
      actorUserId: parsed.data.actor.id,
      mfaVerified: parsed.data.mfaVerified,
      recentAuthenticationVerified: parsed.data.recentAuthenticationVerified,
      requestId: parsed.data.requestId,
    });
    if (!authorization)
      return {
        ok: false,
        code: "SYSTEM_RECOVERY_AUTHORIZATION_REVOKED",
        retryable: false,
      };
    try {
      authorize(authorization, "system:operate", unscopedInternalOnly);
    } catch {
      return {
        ok: false,
        code: "SYSTEM_RECOVERY_PERMISSION_REVOKED",
        retryable: false,
      };
    }
    const claim = await this.claimIdempotency(parsed.data);
    if (claim.kind === "conflict")
      return {
        ok: false,
        code: "SYSTEM_RECOVERY_IDEMPOTENCY_CONFLICT",
        retryable: false,
      };
    try {
      const operation =
        parsed.data.action === "retry"
          ? await this.recovery.retry({
              source: parsed.data.source,
              id: parsed.data.id,
              reason: parsed.data.reason,
              actor: authorizationActor(authorization),
              requestId: parsed.data.requestId,
            })
          : await this.recovery.abandon({
              source: parsed.data.source,
              id: parsed.data.id,
              reason: parsed.data.reason,
              actor: authorizationActor(authorization),
              requestId: parsed.data.requestId,
            });
      return { ok: true, operation, replayed: false };
    } catch (error) {
      if (error instanceof DeadLetterRecoveryError)
        return { ok: false, code: error.code, retryable: false };
      throw error;
    }
  }

  /**
   * One decision per key. The record is written before the decision so a crash
   * between the two cannot present as a fresh key on replay.
   */
  private claimIdempotency(input: {
    actor: Actor;
    action: string;
    source: string;
    id: string;
    reason: string;
    idempotencyKey: string;
    requestId: string;
  }): Promise<{ kind: "claimed" | "conflict" }> {
    const requestHash = coreSnapshotHash({
      resource: "system_recovery",
      id: input.id,
      accountId: null,
      action: input.action,
      expectedVersion: 1,
      payload: { source: input.source, reason: input.reason },
    });
    return withInternalTransaction(
      this.database,
      `${input.requestId}:idempotency`,
      async (transaction) => {
        const rows = await transaction.execute(sql`
          insert into public.lifecycle_idempotency_records (
            owner_user_id, scope, key, request_hash, lock_token,
            locked_until, expires_at
          ) values (
            ${input.actor.id}::uuid, 'system:recovery',
            ${input.idempotencyKey}, ${requestHash}, ${crypto.randomUUID()}::uuid,
            ${new Date(this.now().getTime() + 60_000).toISOString()}::timestamptz,
            ${new Date(this.now().getTime() + 86_400_000).toISOString()}::timestamptz
          )
          on conflict (owner_user_id, scope, key) do nothing
          returning request_hash
        `);
        if (rows.length > 0) return { kind: "claimed" } as const;
        const existing = await transaction.execute(sql`
          select request_hash
          from public.lifecycle_idempotency_records
          where owner_user_id = ${input.actor.id}::uuid
            and scope = 'system:recovery'
            and key = ${input.idempotencyKey}
        `);
        const prior = z
          .object({ request_hash: z.string() })
          .safeParse(existing[0]);
        return prior.success && prior.data.request_hash === requestHash
          ? ({ kind: "claimed" } as const)
          : ({ kind: "conflict" } as const);
      },
    );
  }
}
