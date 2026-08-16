import { randomUUID } from "node:crypto";

import { eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { exceptionQueues } from "@clockwork/domain/lifecycle";

import { createRuntimeDatabase } from "../../client";
import { auditEvents, exceptionCases, outboxMessages } from "../../schema";
import {
  withAuthorizedTransaction,
  withInternalTransaction,
} from "../../transaction";
import { DatabaseLifecycleCommandRepository } from "./command-repository";

/**
 * The exception queue is internal work. This file PINS THAT CONTRACT.
 *
 * A comment at `command-repository.ts:750` used to say `open_exception` and
 * `decide_exception` "are deliberately account-scoped tenant flows and must
 * keep falling through". That comment described an intention nobody
 * implemented, and it was two days old -- it arrived as an aside in the same
 * commit that gave `start_migration` its staff refusal. It was not authority:
 *
 *   * `exception_cases_scope` has carried `with check (app_is_internal())`
 *     since the FOUNDATION migration, so the tenant write path has never
 *     worked at any point in this repository's history.
 *   * Spec S16's queues have internal owners, backups, escalation contacts and
 *     response targets; S6 places every exception queue in the internal back
 *     office and none of the seven customer surfaces offers exception intake;
 *     S2 calls humans-as-queues how the platform routes work to internal
 *     people, "never a step in the happy path".
 *   * Every spec'd tenant-triggered entry is MACHINE-opened. The one
 *     tenant-reachable queue, `poc_qualification`, is opened by the workflow
 *     effect `open_poc_qualification` on the service pool with a system actor
 *     and an idempotent claim. The tenant's act is `create_poc`; the case is a
 *     routing consequence.
 *   * No surface calls the open route. The web client calls only the decision
 *     endpoint, from the internal queues page.
 *
 * A migration admitting tenant inserts was written and then REMOVED, because
 * it was a competent implementation of a product feature nobody specified.
 * "May customers file exceptions directly?" is a product decision about intake
 * and staffing, not a security one -- the security properties underneath are
 * already settled by existing controls, since roster members must be internal
 * staff and MFA-enrolled and exclude the requester, and `decideException`
 * already refuses non-owners and self-approval.
 *
 * The refusal below is the CURRENT CONTRACT, and it is now SAID rather than
 * merely happening. The comment is deleted; `open_exception` and
 * `decide_exception` are classified `internalStaffOnlyCommand` and asserted
 * twice -- once in the command router before a transaction of either kind
 * opens, once inside the method itself -- and
 * `POST /v1/lifecycle/exceptions` and
 * `POST /v1/lifecycle/exceptions/{caseId}/decisions` no longer accept a
 * caller-supplied `accountId` in place of staff status. The database policy
 * still stands underneath all of it; it is simply no longer the first thing a
 * tenant meets.
 *
 * If the product decision ever goes the other way, this repository already
 * names the pattern and no other should be accepted: the terminations split
 * (000900:189-197), the provisioning-attempts split (000200), and 001399's
 * fresh-state pins with enumerated arms.
 */
const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 2,
  role: "clockwork_service",
  ssl: false,
});

const accountId = "10000000-0000-4000-8000-000000000001";
const tenantUserId = "20000000-0000-4000-8000-000000000002";
const queueOwnerUserId = "20000000-0000-4000-8000-000000000001";
const backupUserId = "20000000-0000-4000-8000-000000000005";
const escalationUserId = "20000000-0000-4000-8000-000000000006";
/** Seeded, on the account above, and already immutable. */
const evidenceDocumentId = "40000000-0000-4000-8000-000000000002";

const runId = randomUUID().replaceAll("-", "").slice(0, 10);
const requestPrefix = `exception-tenant-open-${runId}`;

const repository = new DatabaseLifecycleCommandRepository({
  database: db,
  serviceDatabase: db,
  authorizationSecret,
  policies: {
    clickThroughThresholdMinor: "1000000",
    migrationFeatureEnabled: false,
    automatedTeardownEnabled: false,
    exceptionQueues: exceptionQueues.map((queue) => ({
      queue,
      ownerId: queueOwnerUserId,
      backupId: backupUserId,
      targetBusinessHours: 8,
      escalationOwnerId: escalationUserId,
      separationRequired: true,
    })),
  },
});

const tenant: AuthorizationContext = {
  userId: ids.user.parse(tenantUserId),
  accountIds: [ids.account.parse(accountId)],
  roles: ["owner"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};
const internal: AuthorizationContext = {
  userId: ids.user.parse(queueOwnerUserId),
  accountIds: [ids.account.parse(accountId)],
  roles: ["internal_operator"],
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};
/**
 * A second internal caller, so a case can be raised by one person and decided
 * by another. `separationRequired` is on for every queue in this file's policy,
 * so the requester cannot be the decider.
 */
const internalEscalationOwner: AuthorizationContext = {
  ...internal,
  userId: ids.user.parse(escalationUserId),
};

const context = (label: string, authorization: AuthorizationContext) => ({
  requestId: `${requestPrefix}-${label}`,
  idempotencyKey: `${requestPrefix}-${label}`,
  occurredAt: "2026-08-01T12:00:00.000Z",
  actor: { kind: "user" as const, id: authorization.userId },
  authorization,
  ip: "192.0.2.10",
  userAgent: "exception-tenant-open-suite",
});

const openException = (input: {
  label: string;
  authorization: AuthorizationContext;
  objectId: string;
}) =>
  repository.executeInTransaction({
    command: "open_exception",
    payload: {
      accountId,
      queue: "poc_qualification",
      objectType: "poc",
      objectId: input.objectId,
      reason: "A proof of concept needs qualification before it starts",
      evidenceDocumentId,
    },
    context: context(input.label, input.authorization),
  });

afterAll(async () => {
  await withInternalTransaction(db, `${requestPrefix}-cleanup`, async (tx) => {
    const events = await tx
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(like(auditEvents.requestId, `${requestPrefix}%`));
    if (events.length > 0) {
      await tx.delete(outboxMessages).where(
        inArray(
          outboxMessages.eventId,
          events.map(({ id }) => id),
        ),
      );
      await tx.delete(auditEvents).where(
        inArray(
          auditEvents.id,
          events.map(({ id }) => id),
        ),
      );
    }
  });
  await client.end();
});

describe.sequential("the exception queue's staff boundary", () => {
  /**
   * The whole of the fix. Before 001402 this raised
   * `42501 new row violates row-level security policy for table
   * "exception_cases"`, while the identical command from an internal operator
   * -- which routes to the service pool -- opened the case.
   */
  it("refuses a tenant opening a case, and the refusal is the contract", async () => {
    // The account owner is the most privileged tenant caller that can reach
    // the route: `queuePermission.poc_qualification` is `poc:manage`, held by
    // owner, admin and partner_admin, and the route takes the account id from
    // the request body. If any tenant could open a case it would be this one.
    const caseId = randomUUID();
    await expect(
      withAuthorizedTransaction(
        db,
        {
          userId: ids.user.parse(tenantUserId),
          accountIds: [accountId],
          roles: ["owner"],
          isInternalStaff: false,
          requestId: `${requestPrefix}-tenant-open`,
        },
        { secret: authorizationSecret },
        async (tx) =>
          tx.insert(exceptionCases).values({
            id: caseId,
            accountId,
            queue: "poc_qualification",
            objectType: "poc",
            objectId: randomUUID(),
            ownerUserId: queueOwnerUserId,
            backupUserId,
            // The caller's own name: even a correctly attributed row is
            // refused, because the refusal is about the lane, not the actor.
            requesterUserId: tenantUserId,
            escalationOwnerUserId: escalationUserId,
            separationRequired: true,
            targetAt: new Date("2026-08-02T12:00:00.000Z"),
            status: "open",
          }),
      ),
    ).rejects.toThrow();

    // Nothing partial survived the refusal.
    const rows = await withInternalTransaction(
      db,
      `${requestPrefix}-tenant-open-read`,
      async (tx) =>
        tx.select().from(exceptionCases).where(eq(exceptionCases.id, caseId)),
    );
    expect(rows).toHaveLength(0);
  });

  /**
   * The refused half of the new policy, and the part that keeps it from being
   * a widening. A tenant cannot raise a case in another user's name: the row
   * policy pins `requester_user_id` to the authenticated caller, so a forged
   * requester is refused by the database and not only by the command.
   */
  it("refuses a case raised in another user's name", async () => {
    const objectId = randomUUID();
    const forged = withAuthorizedTransaction(
      db,
      {
        userId: ids.user.parse(tenantUserId),
        accountIds: [accountId],
        roles: ["owner"],
        isInternalStaff: false,
        requestId: `${requestPrefix}-forged`,
      },
      { secret: authorizationSecret },
      async (tx) =>
        tx.insert(exceptionCases).values({
          id: randomUUID(),
          accountId,
          queue: "poc_qualification",
          objectType: "poc",
          objectId,
          ownerUserId: queueOwnerUserId,
          backupUserId,
          // Not the caller. Everything else on this row is exactly what the
          // command would have written.
          requesterUserId: escalationUserId,
          escalationOwnerUserId: escalationUserId,
          separationRequired: true,
          targetAt: new Date("2026-08-02T12:00:00.000Z"),
          status: "open",
        }),
    );
    await expect(forged).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  /**
   * The tenant refusal, now stated by the command instead of by the database.
   *
   * `open_exception` and `decide_exception` are classified internal-staff-only
   * in `command-repository.ts`, so a tenant is refused with a named error
   * before a transaction of either kind is opened. Previously the tenant's open
   * reached `exception_cases_scope` and came back as `42501`, and the tenant's
   * decision reached `EXCEPTION_DECIDER_NOT_AUTHORIZED` -- a refusal about the
   * roster, arrived at only after the case had been read. Both refusals are
   * still underneath; neither is the one a tenant meets first any more.
   */
  it("refuses a tenant open before the command opens a transaction", async () => {
    const objectId = randomUUID();
    await expect(
      openException({
        label: "tenant-command-open",
        authorization: tenant,
        objectId,
      }),
    ).rejects.toThrow("EXCEPTION_INTERNAL_STAFF_REQUIRED");

    const rows = await withInternalTransaction(
      db,
      `${requestPrefix}-tenant-command-open-read`,
      async (tx) =>
        tx
          .select()
          .from(exceptionCases)
          .where(eq(exceptionCases.objectId, objectId)),
    );
    expect(rows).toHaveLength(0);
  });

  it("refuses the tenant the decision, before the case is even read", async () => {
    const objectId = randomUUID();
    const opened = await openException({
      label: "for-decision",
      authorization: internal,
      objectId,
    });
    await expect(
      repository.executeInTransaction({
        command: "decide_exception",
        payload: {
          caseId: opened.id,
          accountId,
          queue: "poc_qualification",
          decision: "approved",
          reason: "The tenant approves the review it is the subject of",
          evidenceDocumentId,
        },
        context: context("tenant-decision", tenant),
      }),
    ).rejects.toThrow("EXCEPTION_INTERNAL_STAFF_REQUIRED");

    const untouched = await withInternalTransaction(
      db,
      `${requestPrefix}-decision-read`,
      async (tx) =>
        tx.query.exceptionCases.findFirst({
          where: eq(exceptionCases.id, opened.id),
        }),
    );
    expect(untouched).toMatchObject({ status: "open", decisionReason: null });
  });

  /**
   * The legitimate operation, end to end on the live database: internal staff
   * raise a case and other internal staff decide it. A gate that stopped here
   * would be the defect, not the control.
   */
  it("lets internal staff open a case and another decide it", async () => {
    const objectId = randomUUID();
    const opened = await openException({
      label: "internal-open",
      authorization: internalEscalationOwner,
      objectId,
    });
    expect(opened).toMatchObject({ status: "open" });

    const decided = await repository.executeInTransaction({
      command: "decide_exception",
      payload: {
        caseId: opened.id,
        accountId,
        queue: "poc_qualification",
        decision: "approved",
        reason: "Qualification evidence is complete and the poc may start",
        evidenceDocumentId,
      },
      // The queue's owner, who is not the requester: `separationRequired` is on
      // for every queue in this policy.
      context: context("internal-decision", internal),
    });
    expect(decided).toMatchObject({ status: "approved" });

    const persisted = await withInternalTransaction(
      db,
      `${requestPrefix}-internal-decision-read`,
      async (tx) =>
        tx.query.exceptionCases.findFirst({
          where: eq(exceptionCases.id, opened.id),
        }),
    );
    expect(persisted).toMatchObject({
      status: "approved",
      decisionReason:
        "Qualification evidence is complete and the poc may start",
    });
  });
});
