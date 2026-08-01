import { and, asc, eq } from "drizzle-orm";

import type { Actor } from "@clockwork/contracts";
import {
  assertExceptionRoutingQueue,
  resolveExceptionOwners,
  type ExceptionRosterMember,
  type ExceptionRosterRole,
} from "@clockwork/domain/lifecycle";
import { sanitizeActivationEvidenceReference } from "@clockwork/domain/system";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import {
  accounts,
  agreements,
  commerceUsers,
  exceptionCases,
  invoices,
  orders,
  organizations,
  pocs,
  quotes,
  terminations,
} from "../../schema";
import {
  lifecycleMigrationMatches,
  lifecycleProvisioningAttempts,
} from "../../schema/lifecycle";
import { systemExceptionRoster } from "../../schema/system";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";

interface RoutingInput {
  queue: string;
  aggregateId: string;
  occurredAt: string;
  severity: "warning" | "blocking";
  requestedBy?: string;
}

async function affectedAccountId(
  transaction: RuntimeTransaction,
  aggregateId: string,
): Promise<{ accountId: string; objectType: string }> {
  const candidates: { accountId: string; objectType: string }[] = [];
  const account = await transaction.query.accounts.findFirst({
    where: eq(accounts.id, aggregateId),
    columns: { id: true },
  });
  if (account)
    candidates.push({ accountId: account.id, objectType: "account" });
  const add = (
    row: { accountId: string | null } | undefined,
    objectType: string,
  ) => {
    if (row?.accountId)
      candidates.push({ accountId: row.accountId, objectType });
  };
  add(
    await transaction.query.organizations.findFirst({
      where: eq(organizations.id, aggregateId),
      columns: { accountId: true },
    }),
    "organization",
  );
  add(
    await transaction.query.agreements.findFirst({
      where: eq(agreements.id, aggregateId),
      columns: { accountId: true },
    }),
    "agreement",
  );
  add(
    await transaction.query.quotes.findFirst({
      where: eq(quotes.id, aggregateId),
      columns: { accountId: true },
    }),
    "quote",
  );
  add(
    await transaction.query.orders.findFirst({
      where: eq(orders.id, aggregateId),
      columns: { accountId: true },
    }),
    "order",
  );
  add(
    await transaction.query.invoices.findFirst({
      where: eq(invoices.id, aggregateId),
      columns: { accountId: true },
    }),
    "invoice",
  );
  add(
    await transaction.query.pocs.findFirst({
      where: eq(pocs.id, aggregateId),
      columns: { accountId: true },
    }),
    "poc",
  );
  add(
    await transaction.query.terminations.findFirst({
      where: eq(terminations.id, aggregateId),
      columns: { accountId: true },
    }),
    "termination",
  );
  add(
    await transaction.query.exceptionCases.findFirst({
      where: eq(exceptionCases.id, aggregateId),
      columns: { accountId: true },
    }),
    "exception_case",
  );
  add(
    await transaction.query.lifecycleProvisioningAttempts.findFirst({
      where: eq(lifecycleProvisioningAttempts.id, aggregateId),
      columns: { accountId: true },
    }),
    "provider_operation",
  );
  add(
    await transaction.query.lifecycleMigrationMatches.findFirst({
      where: eq(lifecycleMigrationMatches.id, aggregateId),
      columns: { accountId: true },
    }),
    "approval",
  );
  if (candidates.length === 0)
    throw new Error("EXCEPTION_AFFECTED_ACCOUNT_NOT_FOUND");
  if (candidates.length !== 1)
    throw new Error("EXCEPTION_AFFECTED_ACCOUNT_AMBIGUOUS");
  return candidates[0] as { accountId: string; objectType: string };
}

async function rosterFor(
  transaction: RuntimeTransaction,
  accountId: string,
  queue: string,
): Promise<readonly ExceptionRosterMember[]> {
  const rows = await transaction
    .select({
      id: systemExceptionRoster.id,
      accountId: systemExceptionRoster.accountId,
      queue: systemExceptionRoster.queue,
      userId: systemExceptionRoster.userId,
      role: systemExceptionRoster.role,
      active: systemExceptionRoster.active,
      qualificationEvidenceReference:
        systemExceptionRoster.qualificationEvidenceReference,
      qualifiedUntil: systemExceptionRoster.qualifiedUntil,
      absentFrom: systemExceptionRoster.absentFrom,
      absentUntil: systemExceptionRoster.absentUntil,
      targetMinutes: systemExceptionRoster.targetMinutes,
      priority: systemExceptionRoster.priority,
      internalStaff: commerceUsers.isInternalStaff,
      mfaEnrolled: commerceUsers.mfaEnrolled,
    })
    .from(systemExceptionRoster)
    .innerJoin(
      commerceUsers,
      eq(commerceUsers.id, systemExceptionRoster.userId),
    )
    .where(
      and(
        eq(systemExceptionRoster.accountId, accountId),
        eq(systemExceptionRoster.queue, queue),
      ),
    )
    .orderBy(
      asc(systemExceptionRoster.priority),
      asc(systemExceptionRoster.userId),
    );
  return rows.map((row) => ({
    rosterEntryId: row.id,
    accountId: row.accountId,
    queue: row.queue,
    userId: row.userId,
    role: row.role as ExceptionRosterRole,
    active: row.active,
    internalStaff: row.internalStaff,
    mfaEnrolled: row.mfaEnrolled,
    qualificationEvidenceReference: row.qualificationEvidenceReference,
    qualifiedUntil: row.qualifiedUntil.toISOString(),
    absentFrom: row.absentFrom?.toISOString() ?? null,
    absentUntil: row.absentUntil?.toISOString() ?? null,
    targetMinutes: row.targetMinutes,
    priority: row.priority,
  }));
}

/** Resolves workflow exception ownership solely from affected account state and roster rows. */
export class DatabasePersistedWorkflowExceptionRouting {
  public constructor(
    private readonly database: RuntimeDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public resolve(input: RoutingInput) {
    const queue = assertExceptionRoutingQueue(input.queue);
    return withInternalTransaction(
      this.database,
      `exception-routing:${input.aggregateId}:${queue}`,
      async (transaction) => {
        const affected = await affectedAccountId(
          transaction,
          input.aggregateId,
        );
        const owners = resolveExceptionOwners({
          accountId: affected.accountId,
          queue,
          roster: await rosterFor(transaction, affected.accountId, queue),
          now: this.now(),
          ...(input.requestedBy
            ? { excludedUserIds: [input.requestedBy] }
            : {}),
        });
        return {
          accountId: affected.accountId,
          ownerUserId: owners.ownerUserId,
          backupUserId: owners.backupUserId,
          escalationUserId: owners.escalationUserId,
          objectType: affected.objectType,
          targetAt: new Date(
            Date.parse(input.occurredAt) + owners.targetMinutes * 60_000,
          ).toISOString(),
          absenceEscalated: owners.absenceEscalated,
          rosterEntryIds: owners.rosterEntryIds,
        };
      },
    );
  }
}

export interface UpsertExceptionRosterInput {
  rosterEntryId?: string;
  expectedRowVersion: number;
  accountId: string;
  queue: string;
  userId: string;
  role: ExceptionRosterRole;
  active: boolean;
  qualificationEvidenceReference: string;
  qualifiedUntil: Date;
  absentFrom: Date | null;
  absentUntil: Date | null;
  targetMinutes: number;
  priority: number;
  actor: Actor;
  requestId: string;
  now: Date;
}

/** Audited internal control for qualification, absence, and assignment changes. */
export class DatabaseExceptionRosterAdminService {
  public constructor(private readonly database: RuntimeDatabase) {}

  public upsert(input: UpsertExceptionRosterInput) {
    if (input.actor.kind !== "user")
      throw new Error("EXCEPTION_ROSTER_INTERNAL_OPERATOR_REQUIRED");
    const queue = assertExceptionRoutingQueue(input.queue);
    const evidenceReference = sanitizeActivationEvidenceReference(
      input.qualificationEvidenceReference,
    );
    if (
      !Number.isSafeInteger(input.targetMinutes) ||
      input.targetMinutes < 1 ||
      input.targetMinutes > 43_200
    )
      throw new Error("EXCEPTION_ROSTER_TARGET_INVALID");
    if (
      !Number.isSafeInteger(input.priority) ||
      input.priority < 0 ||
      input.priority > 1_000_000
    )
      throw new Error("EXCEPTION_ROSTER_PRIORITY_INVALID");
    if (
      (input.absentFrom === null) !== (input.absentUntil === null) ||
      (input.absentFrom &&
        input.absentUntil &&
        input.absentFrom >= input.absentUntil)
    )
      throw new Error("EXCEPTION_ROSTER_ABSENCE_INVALID");
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const operator = await transaction.query.commerceUsers.findFirst({
          where: eq(commerceUsers.id, input.actor.id),
        });
        if (!operator?.isInternalStaff || !operator.mfaEnrolled)
          throw new Error("EXCEPTION_ROSTER_INTERNAL_OPERATOR_REQUIRED");
        const user = await transaction.query.commerceUsers.findFirst({
          where: eq(commerceUsers.id, input.userId),
        });
        if (!user?.isInternalStaff || !user.mfaEnrolled)
          throw new Error("EXCEPTION_ROSTER_USER_NOT_ELIGIBLE");
        const existing = input.rosterEntryId
          ? await transaction.query.systemExceptionRoster.findFirst({
              where: eq(systemExceptionRoster.id, input.rosterEntryId),
            })
          : undefined;
        if (existing && existing.accountId !== input.accountId)
          throw new Error("EXCEPTION_ROSTER_ACCOUNT_IMMUTABLE");
        if ((existing?.rowVersion ?? 0) !== input.expectedRowVersion)
          throw new Error("EXCEPTION_ROSTER_VERSION_CONFLICT");
        const values = {
          accountId: input.accountId,
          queue,
          userId: input.userId,
          role: input.role,
          active: input.active,
          qualificationEvidenceReference: evidenceReference,
          qualifiedUntil: input.qualifiedUntil,
          absentFrom: input.absentFrom,
          absentUntil: input.absentUntil,
          targetMinutes: input.targetMinutes,
          priority: input.priority,
          updatedAt: input.now,
        };
        const row = existing
          ? (
              await transaction
                .update(systemExceptionRoster)
                .set(values)
                .where(
                  and(
                    eq(systemExceptionRoster.id, existing.id),
                    eq(
                      systemExceptionRoster.rowVersion,
                      input.expectedRowVersion,
                    ),
                  ),
                )
                .returning()
            )[0]
          : (
              await transaction
                .insert(systemExceptionRoster)
                .values({
                  ...values,
                  ...(input.rosterEntryId ? { id: input.rosterEntryId } : {}),
                })
                .returning()
            )[0];
        if (!row) throw new Error("EXCEPTION_ROSTER_WRITE_FAILED");
        await appendAuditAndOutbox(transaction, {
          accountId: row.accountId,
          aggregateType: "approval",
          aggregateId: row.id,
          aggregateVersion: row.rowVersion,
          eventType: existing
            ? "system.exception_roster.reassigned"
            : "system.exception_roster.assigned",
          actor: input.actor,
          requestId: input.requestId,
          occurredAt: input.now,
          ...(existing
            ? {
                before: {
                  queue: existing.queue,
                  userId: existing.userId,
                  role: existing.role,
                  active: existing.active,
                  absentFrom: existing.absentFrom?.toISOString() ?? null,
                  absentUntil: existing.absentUntil?.toISOString() ?? null,
                },
              }
            : {}),
          after: {
            queue: row.queue,
            userId: row.userId,
            role: row.role,
            active: row.active,
            qualificationEvidenceReference: evidenceReference,
            qualifiedUntil: row.qualifiedUntil.toISOString(),
            absentFrom: row.absentFrom?.toISOString() ?? null,
            absentUntil: row.absentUntil?.toISOString() ?? null,
          },
        });
        return row;
      },
    );
  }

  public reassignOpenCase(input: {
    caseId: string;
    requestedBy: string;
    actor: Actor;
    requestId: string;
    now: Date;
    reason: string;
  }) {
    if (input.actor.kind !== "user")
      throw new Error("EXCEPTION_REASSIGNMENT_INTERNAL_OPERATOR_REQUIRED");
    if (input.reason.trim().length < 8)
      throw new Error("EXCEPTION_REASSIGNMENT_REASON_REQUIRED");
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const operator = await transaction.query.commerceUsers.findFirst({
          where: eq(commerceUsers.id, input.actor.id),
        });
        if (!operator?.isInternalStaff || !operator.mfaEnrolled)
          throw new Error("EXCEPTION_REASSIGNMENT_INTERNAL_OPERATOR_REQUIRED");
        const current = await transaction.query.exceptionCases.findFirst({
          where: eq(exceptionCases.id, input.caseId),
        });
        if (!current) throw new Error("EXCEPTION_CASE_NOT_FOUND");
        if (current.status !== "open") throw new Error("EXCEPTION_NOT_OPEN");
        const owners = resolveExceptionOwners({
          accountId: current.accountId,
          queue: current.queue,
          roster: await rosterFor(
            transaction,
            current.accountId,
            current.queue,
          ),
          now: input.now,
          excludedUserIds: [input.requestedBy],
        });
        const [updated] = await transaction
          .update(exceptionCases)
          .set({
            ownerUserId: owners.ownerUserId,
            backupUserId: owners.backupUserId,
            targetAt: new Date(
              input.now.getTime() + owners.targetMinutes * 60_000,
            ),
            updatedAt: input.now,
            rowVersion: current.rowVersion + 1,
          })
          .where(
            and(
              eq(exceptionCases.id, current.id),
              eq(exceptionCases.rowVersion, current.rowVersion),
              eq(exceptionCases.status, "open"),
            ),
          )
          .returning();
        if (!updated) throw new Error("EXCEPTION_REASSIGNMENT_CONFLICT");
        await appendAuditAndOutbox(transaction, {
          accountId: current.accountId,
          aggregateType: "exception_case",
          aggregateId: current.id,
          aggregateVersion: updated.rowVersion,
          eventType: owners.absenceEscalated
            ? "exception_case.absence_escalated"
            : "exception_case.reassigned",
          actor: input.actor,
          requestId: input.requestId,
          occurredAt: input.now,
          before: {
            ownerUserId: current.ownerUserId,
            backupUserId: current.backupUserId,
            targetAt: current.targetAt.toISOString(),
          },
          after: {
            ownerUserId: updated.ownerUserId,
            backupUserId: updated.backupUserId,
            targetAt: updated.targetAt.toISOString(),
            reason: input.reason.trim(),
            rosterEntryIds: owners.rosterEntryIds,
          },
        });
        return updated;
      },
    );
  }
}
